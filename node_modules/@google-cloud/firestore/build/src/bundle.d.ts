/// <reference types="node" />
import { DocumentSnapshot } from './document';
import { QuerySnapshot } from './reference';
/**
 * Builds a Firestore data bundle with results from the given document and query snapshots.
 *
 * @private
 */
export declare class BundleBuilder {
    private bundleId;
    private documents;
    private namedQueries;
    private latestReadTime;
    constructor(bundleId: string);
    add(documentSnapshot: DocumentSnapshot): BundleBuilder;
    add(queryName: string, querySnapshot: QuerySnapshot): BundleBuilder;
    private addBundledDocument;
    private addNamedQuery;
    /**
     * Converts a IBundleElement to a Buffer whose content is the length prefixed JSON representation
     * of the element.
     * @private
     */
    private elementToLengthPrefixedBuffer;
    build(): Buffer;
}
