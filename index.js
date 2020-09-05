const core = require('@actions/core');
const github = require('@actions/github');

(async () => {
  try {
    const githubSecret = core.getInput('github-secret', { required: true });
    const client = new github.GitHub(githubSecret);

    const creator = github.context.payload.sender.login;
    const opts = client.issues.listForRepo({
      ...github.context.issue,
      creator,
      state: 'all',
    });
    const issues = await github.paginate(opts);

    for (const issue of issues) {
      if (issue.number === github.context.issue.number) {
        continue;
      }

      if (issue.pull_request) {
        return; // Creator is already a contributor.
      }
    }

    await repo.issues.createComment({
      issue_number: github.context.issue.number,
      owner: github.context.github.owner,
      repo: github.context.github.repo,
      body: 'Welcome, new contributor!',
    });
  } catch (error) {
    core.setFailed(error.message);
  }
})();
