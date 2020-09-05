const core = require('@actions/core');
const github = require('@actions/github');

(async () => {
  try {
    // const githubSecret = core.getInput('github-secret');
    const repo = core.getInput('repo');
    const context = core.getInput('context');

    const creator = context.payload.sender.login;
    const opts = repo.issues.listForRepo.endpoint.merge({
      ...context.issue,
      creator,
      state: 'all',
    });
    const issues = await repo.paginate(opts);

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
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: 'Welcome, new contributor!',
    });
  } catch (error) {
    core.setFailed(error.message);
  }
})();
