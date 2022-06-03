const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios").default;

(async () => {
  try {
    const { payload } = github.context;
    const labels = ["EddieHub-API-add", "EddieHub-API-delete"];
    const apiKey = core.getInput("api-key", { required: true });
    const apiURL = core.getInput("api-url", { required: true });
    const repoToken = core.getInput("repo-token", { required: true });
    const client = github.getOctokit(repoToken);
    const currentLabel = payload.label.name;

    const authHeader = { "Client-Token": apiKey };
    const author = github.context.payload.sender;
    const body = {
      githubUsername: author.login,
    };

    if (labels.includes(currentLabel)) {
      try {
        console.log(body);
        if (currentLabel === "EddieHub-API-add") {
          await axios.post(apiURL, body, {
            headers: { ...authHeader },
          });

          await client.issues.createComment({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            issue_number: payload.issue.number,
            body: "You have been ADDED to the EddieHub API",
          });
        }
        if (currentLabel === "EddieHub-API-delete") {
          await axios.delete(`${apiURL}/${author}`, {
            headers: { ...authHeader },
          });

          await client.issues.createComment({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            issue_number: payload.issue.number,
            body: "You have been REMOVED from the EddieHub API",
          });
        }

        await client.issues.update({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          issue_number: payload.issue.number,
          state: "closed",
        });
      } catch (e) {
        console.log(e.response.data);
      }
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();
