# Discord.js Bot Template

A simple Discord bot template using Discord.js v14.

## Setup

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following content:
```
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_bot_client_id_here
```

4. Deploy slash commands:
```bash
node src/deploy-commands.js
```

5. Start the bot:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Features

- Modern Discord.js v14 setup
- Slash command support
- Command handler structure
- Environment variable configuration
- Development mode with nodemon

## Adding Commands

1. Create a new command file in `src/commands/`
2. Follow the structure in `src/commands/ping.js`
3. Re-run the deploy script to update Discord with new commands

## Requirements

- Node.js 16.9.0 or higher
- Discord Bot Token
- Discord Application ID 