const core = require('@actions/core');
const github = require('@actions/github');

(async () => {
  try {
    const githubToken = core.getInput('github-token', { required: true });
    const issueMessage = core.getInput('issue-message');
    const prMessage = core.getInput('pr-message');

    // add a comment to the issue or pull request
    // @TODO: with a markdown sheild / badge
    const client = github.getOctokit(githubToken);
    const context = github.context;

    if (context.payload.action !== 'opened') {
      console.log('No issue / pull request was opened, skipping');
      return;
    }

    const footer = `<p>If you would like to continue contributing to open source and would like to do it with an awesome inclusive community, you should join our <a href="https://discord.com/invite/jZQs6Wu">Discord</a> chat and our <a href="https://github.com/EddieJaoudeCommunity">GitHub Organisation</a> - we help and encourage each other to contribute to open source little and often 🤓 . Any questions let us know.</p>
      `;

    if (!!context.payload.issue) {
      await client.issues.createComment({
        owner: context.issue.owner,
        repo: context.issue.repo,
        issue_number: context.issue.number,
        body: issueMessage + footer
      });
    } else {
      await client.pulls.createReview({
        owner: context.issue.owner,
        repo: context.issue.repo,
        pull_number: context.issue.number,
        body: prMessage + footer,
        event: 'COMMENT'
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();
