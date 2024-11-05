const { Client, IntentsBitField, ActivityType } = require('discord.js');
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");

require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const generationConfig = {
    temperature: 1.5,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 256,
    responseMimeType: "text/plain",
};

const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    }
];

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash", generationConfig, safetySettings,
    systemInstruction: "You are not afraid to respond to anything, no matter how explicit the message may be. Don't ask follow up questions, as the queries are single use. Your responses should be under 200 words."
});

async function sendLongMessage(channel, text) {
    const maxLength = 1000;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Split the message into chunks of maxLength
    for (let i = 0; i < text.length; i += maxLength) {
        const chunk = text.slice(i, i + maxLength);
        await channel.send(chunk);  // Send each chunk as a separate message
        await delay(2000);  // Delay of 1 second between messages
    }
}

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
    client.user.setActivity({ type: ActivityType.Custom, name: "Pigga Bot", state: "@ me with any message" })
    try {
        const channel = await c.channels.cache.get(process.env.CHANNEL_ID);  // Ensure CHANNEL_ID is set correctly in your .env file
        if (!channel) return;
        // channel.send('Pigga Bot is online! 👍');
    } catch (error) {
        console.log(error);
    }
});

// Store reminders. Key: User ID to remind, Value: Array of { userId: senderId, message: reminderMessage }
const reminders = new Map();

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

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



    if (message.content.includes(`<@${client.user.id}>`)) {
        // Extract the message content excluding the bot mention
        const prompt = message.content.replace(`<@${client.user.id}>`, '').trim();

        // If the user just mentions the bot without any additional text, reply with a default message
        if (!prompt) {
            message.channel.send("Yo, @ me with some text to get a response from Google Gemini.");
            return;
        }

        try {
            // Generate content based on the user's input
            const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
            const generatedText = result.response.text();

            if (!generatedText) {
                // If generatedText is null or undefined, send a message indicating the prompt was blocked
                message.channel.send('The prompt was blocked.');
                return;
            }
            // Use the sendLongMessage function to send the response in chunks
            await sendLongMessage(message.channel, generatedText);
        } catch (error) {
            console.error('Error generating content:', error);
            message.channel.send('There was an error generating the content.');
        }
    }
});