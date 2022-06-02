# GitHub Action Community <img src="https://i.imgur.com/m6EYre1.png" width="50px">

GitHub Action for the Community - from welcoming first timers to logging your activity for badges!

## GitHub Action Features 💡

These GitHub Actions will:
- reply to all new **Issues** and **Pull Requests**
- log statistics of user activity to Firestore DB (Firebase)
  
## Quickstart

You can use 1 or all of these GitHub Actions.

To create a GitHub Action
1. In the folder `.github/workflows/`
2. Create a file `welcome.yaml` (or another name you prefer)
3. Add the Action config

### Welcoming message

This GitHub Action will reply to all new **Issues** and **Pull Requests** with a custom message

Example usage (you can change the replies for `issue-message` and `pr-message`)
```yaml
  welcome:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - uses: EddieHubCommunity/gh-action-community/src/welcome@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          issue-message: '<h1>It''s great having you contribute to this project</h1> Feel free to raise an <strong>Issue</strong>! Welcome to the community :nerd_face:'
          pr-message: '<h1>It''s great having you contribute to this project</h1> Feel free to create a <strong>Pull Request</strong>! Welcome to the community :nerd_face:'
```

#### Options

`footer` is an optional parameter, which can be used to append the `issue-message` and `pr-message`

### Store community activity

This GitHub Action will log statistics of user activity to Firestore DB (Firebase)

```yaml
  statistics:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - uses: EddieHubCommunity/gh-action-community/src/statistics@main
        if: ${{ <expression> }}
        with:
          api-key: ${{ secrets.API_TOKEN }}
          api-url: ${{ secrets.API_URI }}
```

Here is a complete example https://github.com/EddieHubCommunity/LinkFree/blob/main/.github/workflows/community.yml
