const core = require("@actions/core");
const github = require("@actions/github");

try {
  // const githubSecret = core.getInput("github-secret");

  const creator = github.context.payload.sender.login;
  const opts = github.issues.listForRepo.endpoint.merge({
    ...github.context.issue,
    creator,
    state: "all",
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

  await github.issues.createComment({
    issue_number: github.context.issue.number,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    body: "Welcome, new contributor!",
  });
} catch (error) {
  core.setFailed(error.message);
}
