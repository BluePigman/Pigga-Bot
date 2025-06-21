const { Client, IntentsBitField, ActivityType } = require('discord.js');
const Groq = require('groq-sdk');
const {
    GoogleGenAI,
  } = require("@google/genai");
const axios = require("axios");
const FormData = require("form-data");

require('dotenv').config();

const groq = new Groq();  // Initialize the Groq client

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});



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
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
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

    // // Add random message feature
    // const randomMessages = [
      // ...
    // ];

    // const channelId = process.env.CHANNEL_ID; // Replace with your target channel ID
    // const channel = await client.channels.fetch(channelId);

    // if (!channel) {
    //     console.error("Channel not found! Please check the channel ID.");
    //     return;
    // }
    // // Function to pick a random message
    // const getRandomMessage = () => {
    //     return randomMessages[Math.floor(Math.random() * randomMessages.length)];
    // };

    // // Send a random message every 6 h
    // setInterval(() => {
    //     const message = getRandomMessage();
    //     channel.send(message).catch((err) => console.error("Failed to send message:", err));
    // }, 1000 * 60 * 60 * 6); // 6 hours in milliseconds
});

// Store reminders. Key: User ID to remind, Value: Array of { userId: senderId, message: reminderMessage }
const reminders = new Map();

const cookieCooldowns = new Map();

const fs = require('fs');
const cookies = JSON.parse(fs.readFileSync('fortuneCookies.json', 'utf-8'));

async function generateImage(prompt) {
  const model = "gemini-2.0-flash-exp-image-generation";

  try {
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ];

    const config = {
      responseModalities: ["IMAGE", "TEXT"],
      responseMimeType: "text/plain",
    };

    const response = await ai.models.generateContentStream({
      model: model,
      contents: contents,
      config: config,
    });

    let imageBuffer = null;
    let imageMimeType = null;

    for await (const chunk of response) {
      if (!chunk.candidates || 
          !chunk.candidates[0] || 
          !chunk.candidates[0].content || 
          !chunk.candidates[0].content.parts) {
        continue;
      }

      // Look for inline data (image) in the chunk
      for (const part of chunk.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          imageBuffer = Buffer.from(part.inlineData.data, "base64");
          imageMimeType = part.inlineData.mimeType || 'image/png';
          break;  
        }
      }

      if (imageBuffer) break;
    }

    if (!imageBuffer) {
      return "No image was generated. The model might have declined to generate an image for this prompt.";
    }

    // Process the image data
    const fileExtension = imageMimeType.split("/")[1] || "png";
    const fileName = `generated_image_${Date.now()}.${fileExtension}`;

    // Upload image to kappa.lol
    const formData = new FormData();
    formData.append("file", imageBuffer, { 
      filename: fileName, 
      contentType: imageMimeType 
    });

    const uploadResponse = await axios.post("https://kappa.lol/api/upload", formData, {
      headers: formData.getHeaders(),
    });

    if (uploadResponse.data && uploadResponse.data.link) {
      return uploadResponse.data.link;
    } else {
      return "Failed to upload the generated image.";
    }

  } catch (error) {
    console.error("Image generation error:", error);
    
    // Provide more detailed error information
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
      return `Error generating image: ${error.message} (Status: ${error.response.status})`;
    }
    
    return "Error generating image: " + error.message;
  }
}


client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // fortune cookie
    if (message.content.startsWith('!cookie')) {
        const userId = message.author.id;
        const now = Date.now();
        const cooldownTime = 1000; // 1 second

        if (cookieCooldowns.has(userId)) {
            const lastRequestTime = cookieCooldowns.get(userId);
            if (now - lastRequestTime < cooldownTime) {
                const remainingTime = cooldownTime - (now - lastRequestTime);
                const hours = Math.floor(remainingTime / (60 * 60 * 1000));
                const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
                message.channel.send(`You need to wait ${hours} hours and ${minutes} minutes before getting another cookie!`);
                return;
            }
        }

        // Update cooldown and provide a fortune cookie
        cookieCooldowns.set(userId, now);
        const randomIndex = Math.floor(Math.random() * cookies.length);
        message.channel.send(cookies[randomIndex].text);
        return;
    }

    // Add image generation command
  if (message.content.startsWith("!generate ")) {
    const prompt = message.content.slice(10).trim();
    if (!prompt) {
      message.channel.send("Please provide a prompt to generate an image.");
      return;
    }

    // Send one loading message
    const loadingMessage = await message.channel.send("Generating image, please wait...");
    
    try {
      // Generate the image with a timeout
      const result = await Promise.race([
        generateImage(prompt),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Image generation timed out after 60 seconds")), 60000)
        )
      ]);
      
      // Edit the loading message with the result
      if (result && typeof result === 'string' && result.startsWith("http")) {
        await loadingMessage.edit(`Generated image for prompt: "${prompt}"\n${result}`);
      } else {
        await loadingMessage.edit(result || "No result received from image generator.");
      }
    } catch (error) {
      console.error("Error in !generate command:", error);
      await loadingMessage.edit(`Failed to generate image: ${error.message}`);
    }

  }

    // Handle reminders or other custom commands here...
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
        // Process all pending reminders
        for (const reminder of userReminders) {
            const sender = await client.users.fetch(reminder.userId);
            message.channel.send(`${message.author}, reminder from ${sender}: ${reminder.message}`);
        }
        reminders.delete(message.author.id); 
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