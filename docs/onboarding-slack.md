# Onboarding messages (Slack)

## 1. To leads

~~~
Hi all,

We're introducing *Claude Observability*, a dashboard that gives visibility into how our Claude subscriptions are used. It covers model usage, daily consumption and proximity to the 5-hour usage limits across Claude Code (terminal, desktop app and IDE).

The collector records usage metrics only (token counts, models and timestamps). It does not capture prompts, responses or code.

*Setup (approx. 5 minutes):*
1. Sign in at https://claude-observability.vercel.app with your work Google account, and create a workspace for your Claude account.
2. Under *Connect machines*, generate an enrollment code.
3. On your machine (Node.js 20 or later required):
```
npm install -g claude-obs
claude-obs login --code XXXX-XXXX
claude-obs sync
claude-obs install-agent
```
4. Share the setup instructions in this thread with your team, including your enrollment code.

Please reach out if you have any questions.
~~~

## 2. From a lead to their reportees

~~~
Hi team,

We're rolling out *claude-obs* to track how we use our shared Claude account. It will help us understand model usage and plan around the 5-hour usage limits.

The tool runs in the background and records usage metrics only (token counts, models and timestamps). It does not capture prompts, responses or code.

Please install it on each machine where you use Claude Code with our team account (Node.js 20 or later required):
```
npm install -g claude-obs
claude-obs login --code <CODE>
claude-obs sync
claude-obs install-agent
```
You can confirm the setup with `claude-obs status`. If you run into any issues, please share the output of `claude-obs doctor`.

Thank you.
~~~
