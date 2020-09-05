const core = require('@actions/core');
const github = require('@actions/github');
const admin = require('firebase-admin');

(async () => {
  try {
    const firebaseKey = core.getInput('firebase-key', { required: true });

    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(firebaseKey)),
    });

    const db = admin.firestore();
    const author = github.context.payload.sender;
    const type = process.env.GITHUB_EVENT_NAME;
console.log(github.context.payload);
    const docRef = db.collection('usersGitHub').doc(author.id);
    await docRef.set({
      ...author,
      type: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
  } catch (error) {
    core.setFailed(error.message);
  }
})();
