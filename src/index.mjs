import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import chat from './config/gemini.mjs';

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Handle message events
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots to prevent potential loops
  if (message.author.bot) return;

  // Check if the bot was mentioned
  if (message.mentions.has(client.user)) {
    // Remove the bot mention and extra spaces from the message
    const contentWithoutMention = message.content
      .replace(`<@${client.user.id}>`, '')
      .trim()
      .toLowerCase(); // Convert to lowercase for case-insensitive matching


    if (contentWithoutMention == "!summarize") {
      // ! retrieve chat log from the channel
      // ! summarize the chat log with the help of gemini

      const channel = message.channel;
      const messages = await channel.messages.fetch({ limit: 100 });

      // [timestamp] [username]: [message]
      const chatLog = messages.map(message => `${message.createdAt} ${message.author.username}: ${message.content}`).join('\n');

      await message.reply("Summarizing...");

      const summary = await chat(chatLog);

      await message.reply(summary.text);
    } else {
    const response = await chat(contentWithoutMention);

    const { text: responseText } = response;
    
    if (responseText.length > 2000) {
      // segmentated the response into 2000 character chunks but in full sentences
      const segments = [];
      let currentSegment = '';
      
      // Split response into sentences using regex that handles multiple punctuation cases
      const sentences = responseText.match(/[^.!?]+[.!?]+/g) || [responseText];
      
      for (const sentence of sentences) {
        // If adding this sentence would exceed 2000 chars, start a new segment
        if ((currentSegment + sentence).length > 2000) {
          segments.push(currentSegment);
          currentSegment = sentence;
        } else {
          currentSegment += sentence;
        }
      }
      
      // Push the last segment if it has content
      if (currentSegment) {
        segments.push(currentSegment);
      }
      
      // Send each segment as a separate message
      for (const segment of segments) {
        await message.reply(segment);
      }
      return; // Exit early since we've handled the response
    }
    
    await message.reply(responseText);
    }
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN); 