const core = require('@actions/core');
const github = require('@actions/github');

(async () => {
  try {
    // const githubSecret = core.getInput('github-token', { required: true });

    console.log('HERE');
  } catch (error) {
    core.setFailed(error.message);
  }
})();
