const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios").default;

(async () => {
  try {
    const apiKey = core.getInput("api-key", { required: true });
    const apiURL = core.getInput("api-url", { required: true });

    const authHeader = { "Client-Token": apiKey };
    // save statistics to db

    const author = github.context.payload.sender;
    const type = process.env.GITHUB_EVENT_NAME;

    const body = {
      githubUsername: author.login,
      event: type,
    };
    try {
      console.log(body);
      await axios.post(apiURL, body, {
        headers: { ...authHeader },
      });
    } catch (e) {
      console.log(e.response.data)
    }
  } catch (error) {
    core.setFailed(error.message);
  }
})();
