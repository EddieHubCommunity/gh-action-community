const core = require('@actions/core');
const github = require('@actions/github');

(async () => {
  try {
    // const githubSecret = core.getInput('github-secret');

    const creator = context.payload.sender.login;
    const opts = github.issues.listForRepo.endpoint.merge({
      ...context.issue,
      creator,
      state: 'all',
    });
    const issues = await github.paginate(opts);

    for (const issue of issues) {
      if (issue.number === context.issue.number) {
        continue;
      }

      if (issue.pull_request) {
        return; // Creator is already a contributor.
      }
    }

    await repo.issues.createComment({
      issue_number: github.context.issue.number,
      owner: context.github.owner,
      repo: context.github.repo,
      body: 'Welcome, new contributor!',
    });
  } catch (error) {
    core.setFailed(error.message);
  }
})();
