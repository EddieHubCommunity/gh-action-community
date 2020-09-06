const core = require('@actions/core');
const github = require('@actions/github');
const admin = require('firebase-admin');

(async () => {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const firebaseKey = core.getInput('firebase-key', { required: true });
    const issueMessage = core.getInput('issue-message');
    const prMessage = core.getInput('pr-message');

    // save statistics to db
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(firebaseKey)),
    });

    const db = admin.firestore();
    const author = github.context.payload.sender;
    const type = process.env.GITHUB_EVENT_NAME;

    const docRef = db.collection('usersGitHub').doc(author.id.toString());
    await docRef.set(
      {
        author,
        id: author.id.toString(),
        [type]: admin.firestore.FieldValue.increment(1),
      },
      { merge: true }
    );

    // add a comment to the issue or pull request
    // @TODO: with a markdown sheild / badge
    const client = new github.GitHub(githubToken);
    const context = github.context;

    if (context.payload.action !== 'opened') {
      console.log('No issue / pull request was opened, skipping');
      return;
    }

    if (!!context.payload.issue) {
      await client.issues.createComment({
        owner: context.issue.owner,
        repo: context.issue.repo,
        issue_number: contextissue.number,
        body: issueMessage
      });
    } else {
      await client.pulls.createReview({
        owner: context.issue.owner,
        repo: context.issue.repo,
        pull_number: context.issue.number,
        body: prMessage,
        event: 'COMMENT'
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();
