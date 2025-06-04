import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Message, Collection, TextChannel, Channel } from 'discord.js';
import chat from './config/gemini.js';
import { segmentText } from './utils/textSegmentation.js';
import { updateChannelContext, saveChannelContextsToFile, loadChannelContextsFromFile, getAndClearPendingMessages, ensureStorageFiles } from './config/gemini.js';
import fetch from 'node-fetch';
import { createUserContent, createPartFromUri } from '@google/genai';
import { GoogleGenAI } from '@google/genai';

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

/**
 * Shows typing indicator in a channel
 * @param channel The channel to show typing in
 */
async function showTyping(channel: Channel) {
  if ('sendTyping' in channel && typeof (channel as any).sendTyping === 'function') {
    try {
      await (channel as any).sendTyping();
    } catch (error) {
      console.error('Error showing typing indicator:', error);
    }
  }
}

/**
 * Fetches all messages from a channel within the last 24 hours
 * @param channel The channel to fetch messages from
 * @returns A collection of messages
 */
async function fetchLast24HourMessages(channel: TextChannel): Promise<Collection<string, Message>> {
  const allMessages = new Collection<string, Message>();
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  let lastId: string | undefined;
  let totalFetched = 0;
  
  try {
    // Keep fetching messages until we reach messages older than 24 hours
    while (true) {
      const options = { limit: 100, ...(lastId ? { before: lastId } : {}) };
      const fetchedMessages = await channel.messages.fetch(options);
      
      if (!fetchedMessages.size) break;

      // Filter and add messages from the last 24 hours
      for (const [id, msg] of fetchedMessages.entries()) {
        if (msg.createdAt > oneDayAgo) {
          allMessages.set(id, msg);
          totalFetched++;
        }
      }

      // If the oldest message in this batch is older than 24 hours, we're done
      const oldestMessage = fetchedMessages.at(-1);
      if (!oldestMessage || oldestMessage.createdAt < oneDayAgo) break;

      lastId = oldestMessage.id;
    }

    console.log(`Successfully fetched ${totalFetched} messages from the last 24 hours`);
    return allMessages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }
}

// Helper to split long text into 4000-char chunks for Gemini API
function splitToGeminiParts(text: string, maxLen = 4000): string[] {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts;
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// On startup, ensure storage files and then load channel context
await ensureStorageFiles();
await loadChannelContextsFromFile();

// After loading, send context summary to Gemini for each channel (memory recall only, do not post to channel)
(async () => {
  // Wait for Discord client to be ready
  await new Promise(resolve => client.once(Events.ClientReady, resolve));
  const { channelContexts } = await import('./config/gemini.js');
  for (const [channelId, context] of channelContexts.entries()) {
    // Create a summary string
    const chatLog = context.recentMessages.slice(-5)
      .map(msg => {
        const date = new Date(msg.timestamp);
        const iso = isNaN(date.getTime()) ? String(msg.timestamp) : date.toISOString();
        return `[${iso}] ${msg.author}: ${msg.content}`;
      })
      .join('\n');
    try {
      await chat({
        author: { username: 'system' },
        member: null,
        guild: null,
        channel: { id: channelId },
        content: '',
      } as any, chatLog);
      console.log(`[Bot] Sent context recall to Gemini for channel ${channelId}`);
    } catch (err) {
      console.error('[Bot] Error sending context recall to Gemini for channel', channelId, err);
    }
  }
})();

// Save channel context every 60 seconds
setInterval(() => {
  saveChannelContextsToFile();
}, 60000);

// Save channel context on exit
process.on('SIGINT', async () => {
  await saveChannelContextsToFile();
  process.exit();
});
process.on('SIGTERM', async () => {
  await saveChannelContextsToFile();
  process.exit();
});

// Every 5 minutes, summarize pending messages and post to channel
setInterval(async () => {
  const pending = await getAndClearPendingMessages();
  if (pending.length === 0) return;
  // Group by channel
  const byChannel: Record<string, any[]> = {};
  for (const msg of pending as any[]) {
    if (!byChannel[msg.channelId]) byChannel[msg.channelId] = [];
    byChannel[msg.channelId].push(msg);
  }
  for (const channelId of Object.keys(byChannel)) {
    const channel = client.channels.cache.get(channelId);
    if (!channel || !('send' in channel)) continue;
    const chatLog = byChannel[channelId]
      .map((msg: any) => {
        const date = new Date(msg.timestamp);
        const iso = isNaN(date.getTime()) ? String(msg.timestamp) : date.toISOString();
        return `[${iso}] ${msg.author}: ${msg.content}`;
      })
      .join('\n');
    try {
      await chat({
        author: { username: 'system' },
        member: null,
        guild: null,
        channel: { id: channelId },
        content: '',
      } as any, chatLog);
      // const summaryText = summary.text || '';
      // const segments = segmentText(summaryText);
      // for (const segment of segments) {
      //   await channel.send(segment);
      // }
    } catch (err) {
      console.error('[Bot] Error sending summary to channel', channelId, err);
    }
  }
}, 5 * 60 * 1000);

// Handle message events
client.on(Events.MessageCreate, async (message: Message) => {
  // Log basic message info
  console.log(`\n[Bot] New message in #${(message.channel as TextChannel).name}`);
  console.log(`[Bot] Author: ${message.author.username}`);
  console.log(`[Bot] Content: ${message.content}`);

  // Update channel context for all messages (except bot messages)
  if (!message.author.bot) {
    updateChannelContext(message);
  }

  // Ignore messages from bots to prevent potential loops
  if (message.author.bot || !client.user) {
    console.log('[Bot] Ignoring message from bot or client not ready');
    return;
  }

  // Check if the bot was mentioned
  if (message.mentions.has(client.user.id)) {
    console.log('[Bot] Bot was mentioned, processing command...');
    
    // Remove the bot mention and extra spaces from the message
    const contentWithoutMention = message.content
      .replace(`<@${client.user.id}>`, '')
      .trim()
      .toLowerCase(); // Convert to lowercase for case-insensitive matching

    // Extract command and remaining content
    const [command, ...args] = contentWithoutMention.split(' ');
    const content = args.join(' ');

    console.log(`[Bot] Command: ${command}`);
    console.log(`[Bot] Arguments: ${content}`);

    // --- IMAGE PROCESSING LOGIC ---
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (!attachment.contentType?.startsWith('image/')) continue;
        try {
          await showTyping(message.channel);
          // Download the image
          const response = await fetch(attachment.url);
          const arrayBuffer = await response.arrayBuffer();
          // Convert to Blob for Gemini upload
          const blob = new Blob([arrayBuffer], { type: attachment.contentType || 'image/jpeg' });
          // Upload the image to Gemini
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const uploadedFile = await ai.files.upload({
            file: blob,
            config: { mimeType: attachment.contentType || 'image/jpeg' }
          });
          // Generate a caption or answer about the image
          const mimeType = uploadedFile.mimeType || attachment.contentType || 'image/jpeg';
          if (!uploadedFile.uri) {
            await message.reply("Sorry, I couldn't process that image (no file URI returned)! 😅");
            break;
          }
          const prompt = "Describe this image in detail, and mention anything interesting or unusual you notice.";
          const promptParts = splitToGeminiParts(prompt);
          const geminiContents = [createPartFromUri(uploadedFile.uri, mimeType), ...promptParts];
          const geminiResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-05-20',
            contents: createUserContent(geminiContents),
            config: {
              tools: [
                {
                  googleSearch: {}
                }
              ]
            }
          });
          const responseText = geminiResponse.text || "I couldn't process the image, sorry!";
          const segments = segmentText(responseText);
          for (const segment of segments) {
            await showTyping(message.channel);
            await message.reply(segment);
            // Add bot reply to channel context
            const botReply = {
              guild: message.guild,
              channel: message.channel,
              author: client.user,
              content: segment,
              mentions: { users: new Map(), members: new Map() },
              member: null,
              createdAt: new Date(),
            } as unknown as Message;
            updateChannelContext(botReply);
          }
        } catch (err) {
          console.error('[Bot] Error processing image:', err);
          await message.reply("Sorry, I couldn't process that image! 😅");
        }
        break; // Only process the first image
      }
      return; // Don't process further if image was handled
    }

    switch (command) {
      case '!summarize': {
        console.log('[Bot] Processing summarize command');
        try {
          await showTyping(message.channel);
          await message.reply("🔍 Let me gather the chat history for you! Just a moment... ✨");

          if (!(message.channel instanceof TextChannel)) {
            console.log('[Bot] Error: Not a text channel');
            await message.reply("Oops! 😅 I can only summarize messages in regular text channels. Let's try that there!");
            break;
          }

          // Retrieve chat log from the channel for the last 24 hours
          console.log('[Bot] Fetching last 24 hours of messages...');
          const messages = await fetchLast24HourMessages(message.channel);
          
          if (messages.size === 0) {
            console.log('[Bot] No messages found in the last 24 hours');
            await message.reply("Hmm... 🤔 I couldn't find any messages from the last 24 hours. Let's wait for some more chat activity!");
            break;
          }

          console.log(`[Bot] Found ${messages.size} messages to summarize`);
          await showTyping(message.channel);
          await message.reply(`🎉 Great! I found ${messages.size} messages to summarize. Let me create a fun recap for you! 🌟`);

          // [timestamp] [username]: [message]
          const chatLog = Array.from(messages.values())
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) // Sort by timestamp
            .map(msg => {
              const date = new Date(msg.createdAt);
              const iso = isNaN(date.getTime()) ? String(msg.createdAt) : date.toISOString();
              return `${iso} ${msg.author.username}: ${msg.content}`;
            })
            .join('\n');

          console.log('[Bot] Generated chat log for summarization');
          console.log(`[Bot] Chat log length: ${chatLog.length} characters`);
          console.log('[Bot] First few messages:', chatLog.split('\n').slice(0, 3));

          await showTyping(message.channel);
          console.log('[Bot] Requesting summary from Gemini...');
          // Split chatLog into 4000-char parts
          const chatLogParts = splitToGeminiParts(chatLog);
          const summary = await chat(message, chatLogParts);
          const summaryText = summary.text || '';
          console.log('[Bot] Received summary from Gemini');
          // Handle long messages by splitting them into segments
          const segments = segmentText(summaryText);
          console.log(`[Bot] Split summary into ${segments.length} segments`);
          // Send each segment as a separate message
          for (const segment of segments) {
            await showTyping(message.channel);
            await message.reply(segment);
            // Add bot reply to channel context
            const botReply = {
              guild: message.guild,
              channel: message.channel,
              author: client.user,
              content: segment,
              mentions: { users: new Map(), members: new Map() },
              member: null,
              createdAt: new Date(),
            } as unknown as Message;
            updateChannelContext(botReply);
            console.log('[Bot] Sent summary segment');
          }
        } catch (error) {
          console.error('[Bot] Error in summarize command:', error);
          await message.reply("Oh no! 😅 Something went wrong while I was working on the summary. Let's try again in a bit! 🌟");
        }
        break;
      }
      
      case '!help': {
        console.log('[Bot] Processing help command');
        const helpMessage = [
          '**Hey there! 👋 Here are all the fun things we can do together:**',
          '',
          '🔍 `@bot !summarize` - I\'ll create a cheerful recap of the last 24 hours of chat!',
          '💭 `@bot <message>` - Chat with me about anything! I love making new friends!',
          '❓ `@bot !help` - I\'ll show you this helpful message again!',
          '',
          'Don\'t be shy - let\'s chat! 🌟'
        ].join('\n');
        
        await message.reply(helpMessage);
        console.log('[Bot] Sent help message');
        break;
      }

      default: {
        // Default case handles normal chat interaction
        console.log('[Bot] Processing chat message');
        try {
          await showTyping(message.channel);
          console.log('[Bot] Requesting response from Gemini...');
          const chatParts = splitToGeminiParts(contentWithoutMention);
          const response = await chat(message, chatParts);
          const responseText = response.text || '';
          console.log('[Bot] Received response from Gemini');
          
          // Handle long messages by splitting them into segments
          const segments = segmentText(responseText);
          console.log(`[Bot] Split response into ${segments.length} segments`);
          
          // Send each segment as a separate message
          for (const segment of segments) {
            await showTyping(message.channel);
            await message.reply(segment);
            // Add bot reply to channel context
            const botReply = {
              guild: message.guild,
              channel: message.channel,
              author: client.user,
              content: segment,
              mentions: { users: new Map(), members: new Map() },
              member: null,
              createdAt: new Date(),
            } as unknown as Message;
            updateChannelContext(botReply);
            console.log('[Bot] Sent response segment');
          }
        } catch (error) {
          console.error('[Bot] Error in chat:', error);
          await message.reply("Oops! 😅 Something went a bit wrong there. Let's try chatting again! ✨");
        }
      }
    }
  } else {
    console.log('[Bot] Message did not mention bot, ignoring');
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN); 