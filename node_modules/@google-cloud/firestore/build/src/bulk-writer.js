"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const google_gax_1 = require("google-gax");
const assert = require("assert");
const backoff_1 = require("./backoff");
const rate_limiter_1 = require("./rate-limiter");
const util_1 = require("./util");
const write_batch_1 = require("./write-batch");
const logger_1 = require("./logger");
/*!
 * The maximum number of writes that can be in a single batch.
 */
const MAX_BATCH_SIZE = 20;
/*!
 * The starting maximum number of operations per second as allowed by the
 * 500/50/5 rule.
 *
 * https://cloud.google.com/datastore/docs/best-practices#ramping_up_traffic.
 */
const STARTING_MAXIMUM_OPS_PER_SECOND = 500;
/*!
 * The rate by which to increase the capacity as specified by the 500/50/5 rule.
 *
 * https://cloud.google.com/datastore/docs/best-practices#ramping_up_traffic.
 */
const RATE_LIMITER_MULTIPLIER = 1.5;
/*!
 * How often the operations per second capacity should increase in milliseconds
 * as specified by the 500/50/5 rule.
 *
 * https://cloud.google.com/datastore/docs/best-practices#ramping_up_traffic.
 */
const RATE_LIMITER_MULTIPLIER_MILLIS = 5 * 60 * 1000;
/*!
 * Used to represent the state of batch.
 *
 * Writes can only be added while the batch is OPEN. For a batch to be sent,
 * the batch must be READY_TO_SEND. After a batch is sent, it is marked as SENT.
 */
var BatchState;
(function (BatchState) {
    BatchState[BatchState["OPEN"] = 0] = "OPEN";
    BatchState[BatchState["READY_TO_SEND"] = 1] = "READY_TO_SEND";
    BatchState[BatchState["SENT"] = 2] = "SENT";
})(BatchState || (BatchState = {}));
/**
 * Used to represent a batch on the BatchQueue.
 *
 * @private
 */
class BulkCommitBatch {
    constructor(firestore, writeBatch, maxBatchSize) {
        this.firestore = firestore;
        this.writeBatch = writeBatch;
        this.maxBatchSize = maxBatchSize;
        /**
         * The state of the batch.
         */
        this.state = BatchState.OPEN;
        // A deferred promise that is resolved after the batch has been sent, and a
        // response is received.
        this.completedDeferred = new util_1.Deferred();
        // A map from each write's document path to its corresponding result.
        // Only contains writes that have not been resolved.
        this.pendingOps = new Map();
        this.backoff = new backoff_1.ExponentialBackoff();
    }
    /**
     * The number of writes in this batch.
     */
    get opCount() {
        return this.pendingOps.size;
    }
    /**
     * Adds a `create` operation to the WriteBatch. Returns a promise that
     * resolves with the result of the write.
     */
    create(documentRef, data) {
        this.writeBatch.create(documentRef, data);
        return this.processOperation(documentRef);
    }
    /**
     * Adds a `delete` operation to the WriteBatch. Returns a promise that
     * resolves with the sentinel value (Timestamp(0)) for the delete operation.
     */
    delete(documentRef, precondition) {
        this.writeBatch.delete(documentRef, precondition);
        return this.processOperation(documentRef);
    }
    /**
     * Adds a `set` operation to the WriteBatch. Returns a promise that
     * resolves with the result of the write.
     */
    set(documentRef, data, options) {
        this.writeBatch.set(documentRef, data, options);
        return this.processOperation(documentRef);
    }
    /**
     * Adds an `update` operation to the WriteBatch. Returns a promise that
     * resolves with the result of the write.
     */
    update(documentRef, dataOrField, ...preconditionOrValues) {
        this.writeBatch.update(documentRef, dataOrField, ...preconditionOrValues);
        return this.processOperation(documentRef);
    }
    /**
     * Helper to update data structures associated with the operation and
     * return the result.
     */
    processOperation(documentRef) {
        assert(!this.pendingOps.has(documentRef.path), 'Batch should not contain writes to the same document');
        assert(this.state === BatchState.OPEN, 'Batch should be OPEN when adding writes');
        const deferred = new util_1.Deferred();
        this.pendingOps.set(documentRef.path, deferred);
        if (this.opCount === this.maxBatchSize) {
            this.state = BatchState.READY_TO_SEND;
        }
        return deferred.promise.then(result => {
            if (result.writeTime) {
                return new write_batch_1.WriteResult(result.writeTime);
            }
            else {
                throw result.status;
            }
        });
    }
    /**
     * Commits the batch and returns a promise that resolves when all the writes
     * in the batch have finished.
     *
     * If any writes in the batch fail with a retryable error, this method will
     * retry the failed writes.
     */
    async bulkCommit() {
        assert(this.state === BatchState.READY_TO_SEND, 'The batch should be marked as READY_TO_SEND before committing');
        this.state = BatchState.SENT;
        // Capture the error stack to preserve stack tracing across async calls.
        const stack = Error().stack;
        let results = [];
        for (let attempt = 0; attempt < backoff_1.MAX_RETRY_ATTEMPTS; attempt++) {
            await this.backoff.backoffAndWait();
            try {
                results = await this.writeBatch.bulkCommit();
            }
            catch (err) {
                // Map the failure to each individual write's result.
                results = [...this.pendingOps.keys()].map(path => {
                    return { key: path, writeTime: null, status: util_1.wrapError(err, stack) };
                });
            }
            this.processResults(results);
            if (this.pendingOps.size > 0) {
                logger_1.logger('BulkWriter.bulkCommit', null, `Current batch failed at retry #${attempt}. Num failures: ` +
                    `${this.pendingOps.size}.`);
                this.writeBatch = new write_batch_1.WriteBatch(this.firestore, this.writeBatch, [
                    ...this.pendingOps.keys(),
                ]);
            }
            else {
                this.completedDeferred.resolve();
                return;
            }
        }
        this.failRemainingOperations(results);
        this.completedDeferred.resolve();
    }
    /**
     * Resolves the individual operations in the batch with the results.
     */
    processResults(results) {
        for (const result of results) {
            if (result.status.code === google_gax_1.Status.OK) {
                this.pendingOps.get(result.key).resolve(result);
                this.pendingOps.delete(result.key);
            }
            else if (!this.shouldRetry(result.status.code)) {
                this.pendingOps.get(result.key).reject(result.status);
                this.pendingOps.delete(result.key);
            }
        }
    }
    failRemainingOperations(results) {
        for (const result of results) {
            assert(result.status.code !== google_gax_1.Status.OK, 'Should not fail successful operation');
            this.pendingOps.get(result.key).reject(result.status);
            this.pendingOps.delete(result.key);
        }
    }
    shouldRetry(code) {
        const retryCodes = util_1.getRetryCodes('batchWrite');
        return code !== undefined && retryCodes.includes(code);
    }
    hasPath(path) {
        for (const [docPath] of this.pendingOps) {
            if (docPath === path)
                return true;
        }
        return false;
    }
    docPaths() {
        return this.pendingOps.keys();
    }
    /**
     * Returns a promise that resolves when the batch has been sent, and a
     * response is received.
     */
    awaitBulkCommit() {
        this.markReadyToSend();
        return this.completedDeferred.promise;
    }
    markReadyToSend() {
        if (this.state === BatchState.OPEN) {
            this.state = BatchState.READY_TO_SEND;
        }
    }
}
/**
 * A Firestore BulkWriter than can be used to perform a large number of writes
 * in parallel. Writes to the same document will be executed sequentially.
 *
 * @class
 */
class BulkWriter {
    constructor(firestore, enableThrottling) {
        this.firestore = firestore;
        /**
         * The maximum number of writes that can be in a single batch.
         */
        this.maxBatchSize = MAX_BATCH_SIZE;
        /**
         * A queue of batches to be written.
         */
        this.batchQueue = [];
        /**
         * Whether this BulkWriter instance is closed. Once closed, it cannot be
         * opened again.
         */
        this.closed = false;
        this.firestore._incrementBulkWritersCount();
        if (enableThrottling) {
            this.rateLimiter = new rate_limiter_1.RateLimiter(STARTING_MAXIMUM_OPS_PER_SECOND, RATE_LIMITER_MULTIPLIER, RATE_LIMITER_MULTIPLIER_MILLIS);
        }
        else {
            this.rateLimiter = new rate_limiter_1.RateLimiter(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        }
    }
    /**
     * Create a document with the provided data. This single operation will fail
     * if a document exists at its location.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * created.
     * @param {T} data The object to serialize as the document.
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the write. Throws an error if the write fails.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.collection('col').doc();
     *
     * bulkWriter
     *  .create(documentRef, {foo: 'bar'})
     *  .then(result => {
     *    console.log('Successfully executed write at: ', result);
     *  })
     *  .catch(err => {
     *    console.log('Write failed with: ', err);
     *  });
     * });
     */
    create(documentRef, data) {
        this.verifyNotClosed();
        const bulkCommitBatch = this.getEligibleBatch(documentRef);
        const resultPromise = bulkCommitBatch.create(documentRef, data);
        this.sendReadyBatches();
        return resultPromise;
    }
    /**
     * Delete a document from the database.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * deleted.
     * @param {Precondition=} precondition A precondition to enforce for this
     * delete.
     * @param {Timestamp=} precondition.lastUpdateTime If set, enforces that the
     * document was last updated at lastUpdateTime. Fails the batch if the
     * document doesn't exist or was last updated at a different time.
     * @returns {Promise<WriteResult>} A promise that resolves with a sentinel
     * Timestamp indicating that the delete was successful. Throws an error if
     * the write fails.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.doc('col/doc');
     *
     * bulkWriter
     *  .delete(documentRef)
     *  .then(result => {
     *    console.log('Successfully deleted document');
     *  })
     *  .catch(err => {
     *    console.log('Delete failed with: ', err);
     *  });
     * });
     */
    delete(documentRef, precondition) {
        this.verifyNotClosed();
        const bulkCommitBatch = this.getEligibleBatch(documentRef);
        const resultPromise = bulkCommitBatch.delete(documentRef, precondition);
        this.sendReadyBatches();
        return resultPromise;
    }
    /**
     * Write to the document referred to by the provided
     * [DocumentReference]{@link DocumentReference}. If the document does not
     * exist yet, it will be created. If you pass [SetOptions]{@link SetOptions}.,
     * the provided data can be merged into the existing document.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * set.
     * @param {T} data The object to serialize as the document.
     * @param {SetOptions=} options An object to configure the set behavior.
     * @param {boolean=} options.merge - If true, set() merges the values
     * specified in its data argument. Fields omitted from this set() call remain
     * untouched.
     * @param {Array.<string|FieldPath>=} options.mergeFields - If provided, set()
     * only replaces the specified field paths. Any field path that is not
     * specified is ignored and remains untouched.
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the write. Throws an error if the write fails.
     *
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.collection('col').doc();
     *
     * bulkWriter
     *  .set(documentRef, {foo: 'bar'})
     *  .then(result => {
     *    console.log('Successfully executed write at: ', result);
     *  })
     *  .catch(err => {
     *    console.log('Write failed with: ', err);
     *  });
     * });
     */
    set(documentRef, data, options) {
        this.verifyNotClosed();
        const bulkCommitBatch = this.getEligibleBatch(documentRef);
        const resultPromise = bulkCommitBatch.set(documentRef, data, options);
        this.sendReadyBatches();
        return resultPromise;
    }
    /**
     * Update fields of the document referred to by the provided
     * [DocumentReference]{@link DocumentReference}. If the document doesn't yet
     * exist, the update fails and the entire batch will be rejected.
     *
     * The update() method accepts either an object with field paths encoded as
     * keys and field values encoded as values, or a variable number of arguments
     * that alternate between field paths and field values. Nested fields can be
     * updated by providing dot-separated field path strings or by providing
     * FieldPath objects.
     *
     *
     * A Precondition restricting this update can be specified as the last
     * argument.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * updated.
     * @param {UpdateData|string|FieldPath} dataOrField An object containing the
     * fields and values with which to update the document or the path of the
     * first field to update.
     * @param {...(Precondition|*|string|FieldPath)} preconditionOrValues - An
     * alternating list of field paths and values to update or a Precondition to
     * restrict this update
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the write. Throws an error if the write fails.
     *
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.doc('col/doc');
     *
     * bulkWriter
     *  .update(documentRef, {foo: 'bar'})
     *  .then(result => {
     *    console.log('Successfully executed write at: ', result);
     *  })
     *  .catch(err => {
     *    console.log('Write failed with: ', err);
     *  });
     * });
     */
    update(documentRef, dataOrField, ...preconditionOrValues) {
        this.verifyNotClosed();
        const bulkCommitBatch = this.getEligibleBatch(documentRef);
        const resultPromise = bulkCommitBatch.update(documentRef, dataOrField, ...preconditionOrValues);
        this.sendReadyBatches();
        return resultPromise;
    }
    /**
     * Commits all writes that have been enqueued up to this point in parallel.
     *
     * Returns a Promise that resolves when all currently queued operations have
     * been committed. The Promise will never be rejected since the results for
     * each individual operation are conveyed via their individual Promises.
     *
     * The Promise resolves immediately if there are no pending writes. Otherwise,
     * the Promise waits for all previously issued writes, but it does not wait
     * for writes that were added after the method is called. If you want to wait
     * for additional writes, call `flush()` again.
     *
     * @return {Promise<void>} A promise that resolves when all enqueued writes
     * up to this point have been committed.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter.create(documentRef, {foo: 'bar'});
     * bulkWriter.update(documentRef2, {foo: 'bar'});
     * bulkWriter.delete(documentRef3);
     * await flush().then(() => {
     *   console.log('Executed all writes');
     * });
     */
    async flush() {
        this.verifyNotClosed();
        const trackedBatches = this.batchQueue;
        const writePromises = trackedBatches.map(batch => batch.awaitBulkCommit());
        this.sendReadyBatches();
        await Promise.all(writePromises);
    }
    /**
     * Commits all enqueued writes and marks the BulkWriter instance as closed.
     *
     * After calling `close()`, calling any method wil throw an error.
     *
     * Returns a Promise that resolves when there are no more pending writes. The
     * Promise will never be rejected. Calling this method will send all requests.
     * The promise resolves immediately if there are no pending writes.
     *
     * @return {Promise<void>} A promise that resolves when all enqueued writes
     * up to this point have been committed.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter.create(documentRef, {foo: 'bar'});
     * bulkWriter.update(documentRef2, {foo: 'bar'});
     * bulkWriter.delete(documentRef3);
     * await close().then(() => {
     *   console.log('Executed all writes');
     * });
     */
    close() {
        this.verifyNotClosed();
        this.firestore._decrementBulkWritersCount();
        const flushPromise = this.flush();
        this.closed = true;
        return flushPromise;
    }
    verifyNotClosed() {
        if (this.closed) {
            throw new Error('BulkWriter has already been closed.');
        }
    }
    /**
     * Return the first eligible batch that can hold a write to the provided
     * reference, or creates one if no eligible batches are found.
     *
     * @private
     */
    getEligibleBatch(ref) {
        if (this.batchQueue.length > 0) {
            const lastBatch = this.batchQueue[this.batchQueue.length - 1];
            if (lastBatch.state === BatchState.OPEN && !lastBatch.hasPath(ref.path)) {
                return lastBatch;
            }
        }
        return this.createNewBatch();
    }
    /**
     * Creates a new batch and adds it to the BatchQueue. If there is already a
     * batch enqueued, sends the batch after a new one is created.
     *
     * @private
     */
    createNewBatch() {
        const newBatch = new BulkCommitBatch(this.firestore, this.firestore.batch(), this.maxBatchSize);
        if (this.batchQueue.length > 0) {
            this.batchQueue[this.batchQueue.length - 1].markReadyToSend();
            this.sendReadyBatches();
        }
        this.batchQueue.push(newBatch);
        return newBatch;
    }
    /**
     * Attempts to send batches starting from the front of the BatchQueue until a
     * batch cannot be sent.
     *
     * After a batch is complete, try sending batches again.
     *
     * @private
     */
    sendReadyBatches() {
        const unsentBatches = this.batchQueue.filter(batch => batch.state === BatchState.READY_TO_SEND);
        let index = 0;
        while (index < unsentBatches.length &&
            this.isBatchSendable(unsentBatches[index])) {
            const batch = unsentBatches[index];
            // Send the batch if it is under the rate limit, or schedule another
            // attempt after the appropriate timeout.
            const delayMs = this.rateLimiter.getNextRequestDelayMs(batch.opCount);
            assert(delayMs !== -1, 'Batch size should be under capacity');
            if (delayMs === 0) {
                this.sendBatch(batch);
            }
            else {
                backoff_1.delayExecution(() => this.sendReadyBatches(), delayMs);
                break;
            }
            index++;
        }
    }
    /**
     * Sends the provided batch and processes the results. After the batch is
     * committed, sends the next group of ready batches.
     *
     * @private
     */
    sendBatch(batch) {
        const success = this.rateLimiter.tryMakeRequest(batch.opCount);
        assert(success, 'Batch should be under rate limit to be sent.');
        batch.bulkCommit().then(() => {
            // Remove the batch from the BatchQueue after it has been processed.
            const batchIndex = this.batchQueue.indexOf(batch);
            assert(batchIndex !== -1, 'The batch should be in the BatchQueue');
            this.batchQueue.splice(batchIndex, 1);
            this.sendReadyBatches();
        });
    }
    /**
     * Checks that the provided batch is sendable. To be sendable, a batch must:
     * (1) be marked as READY_TO_SEND
     * (2) not write to references that are currently in flight
     *
     * @private
     */
    isBatchSendable(batch) {
        if (batch.state !== BatchState.READY_TO_SEND) {
            return false;
        }
        for (const path of batch.docPaths()) {
            const isRefInFlight = this.batchQueue
                .filter(batch => batch.state === BatchState.SENT)
                .find(batch => batch.hasPath(path)) !== undefined;
            if (isRefInFlight) {
                // eslint-disable-next-line no-console
                console.warn('[BulkWriter]', `Duplicate write to document "${path}" detected.`, 'Writing to the same document multiple times will slow down BulkWriter. ' +
                    'Write to unique documents in order to maximize throughput.');
                return false;
            }
        }
        return true;
    }
    /**
     * Sets the maximum number of allowed operations in a batch.
     *
     * @private
     */
    // Visible for testing.
    _setMaxBatchSize(size) {
        this.maxBatchSize = size;
    }
}
exports.BulkWriter = BulkWriter;
//# sourceMappingURL=bulk-writer.js.map