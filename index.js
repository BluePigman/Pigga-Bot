// Import necessary modules
const { Client, IntentsBitField, ActivityType } = require('discord.js');
const Groq = require('groq-sdk');

require('dotenv').config();

const groq = new Groq();  // Initialize the Groq client

// Async function for generating content
async function generateGroqResponse(prompt) {
    const chatCompletion = await groq.chat.completions.create({
        "messages": [
            {
                "role": "system",
                "content": process.env.SYSTEM_INSTRUCTION  // Accessing the instruction from .env
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "model": "llama3-groq-70b-8192-tool-use-preview",
        "temperature": 0.54,
        "max_tokens": 1024,
        "top_p": 0.65,
        "stream": true,
        "stop": null
    });

    let responseText = "";
    for await (const chunk of chatCompletion) {
        responseText += chunk.choices[0]?.delta?.content || '';
    }

    return responseText;
}

// Function to send long messages in chunks
async function sendLongMessage(channel, text) {
    const maxLength = 1000;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < text.length; i += maxLength) {
        const chunk = text.slice(i, i + maxLength);
        await channel.send(chunk);
        await delay(2000);
    }
}

// Discord client setup
const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMembers,
    ]
});

(async () => {
    try {
        await client.login(process.env.TOKEN);
    } catch (error) {
        console.log(`There was an error: ${error}`);
    }
})();

client.on("ready", async (c) => {
    console.log(`${c.user.tag} is online! 👍`);
    client.user.setActivity({ type: ActivityType.Custom, name: "Pigga Bot", state: "@ me with any message" });
});

// Store reminders. Key: User ID to remind, Value: Array of { userId: senderId, message: reminderMessage }
const reminders = new Map();

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Handle reminders or other custom commands here...
    // Handle reminders
    if (message.content.startsWith('!remind')) {
        const args = message.content.slice(7).trim().split(/ +/);
        if (args.length < 2) {
            message.channel.send("Usage: !remind @user message");
            return;
        }

        const mentionedUser = message.mentions.users.first();
        if (!mentionedUser) {
            message.channel.send("Please mention a user to remind.");
            return;
        }

        const reminderMessage = args.slice(1).join(' ');
        const reminder = { userId: message.author.id, message: reminderMessage };

        if (!reminders.has(mentionedUser.id)) {
            reminders.set(mentionedUser.id, []);
        }
        reminders.get(mentionedUser.id).push(reminder);
        message.channel.send(`Reminder set for ${mentionedUser}.`);
        return;
    }

    // Check for pending reminders
    if (reminders.has(message.author.id)) {
        const userReminders = reminders.get(message.author.id);
        //Process all pending reminders
        for (const reminder of userReminders) {
            const sender = await client.users.fetch(reminder.userId);
            message.channel.send(`${message.author}, reminder from ${sender}: ${reminder.message}`);
        }
        reminders.delete(message.author.id); // Delete all reminders after delivery
    }

    // Check if the bot was mentioned
    if (message.content.includes(`<@${client.user.id}>`)) {
        const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();

        if (!prompt) {
            message.channel.send("Yo, @ me with some text to get a response from Groq.");
            return;
        }

        try {
            // Generate content using Groq
            const generatedText = await generateGroqResponse(prompt);

            if (!generatedText) {
                message.channel.send('The prompt was blocked.');
                return;
            }
            // Send the response in chunks if necessary
            await sendLongMessage(message.channel, generatedText);
        } catch (error) {
            console.error('Error generating content:', error);
            message.channel.send('There was an error generating the content.');
        }
    }
});
