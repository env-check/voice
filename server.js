import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";
import { GoogleSpreadsheet } from "google-spreadsheet";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const calls = {};

// ---------- Incoming Call ----------
app.post("/incoming-call", (req, res) => {
  const callId = req.body.CallSid;
  calls[callId] = [];

  const twiml = `
<Response>
  <Say>Hello, this is FYD Homes assistant. What are you looking for?</Say>
  <Gather input="speech" action="/gather" method="POST" speechTimeout="auto" />
</Response>
`;

  res.type("text/xml").send(twiml);
});

// ---------- Gather ----------
app.post("/gather", (req, res) => {
  const callId = req.body.CallSid;
  const userText = req.body.SpeechResult || "";

  calls[callId].push({ role: "user", text: userText });

  const agentText = "Please tell me your name and phone number in digits.";

  calls[callId].push({ role: "assistant", text: agentText });

  const twiml = `
<Response>
  <Say>${agentText}</Say>
  <Gather input="speech" action="/gather" method="POST" speechTimeout="auto" />
</Response>
`;

  res.type("text/xml").send(twiml);
});

// ---------- Call End ----------
app.post("/call-status", async (req, res) => {
  const callId = req.body.CallSid;

  if (req.body.CallStatus === "completed") {
    const conversation = calls[callId] || [];

    const transcript = conversation
      .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
      .join("\n");

    console.log("Transcript:", transcript);

    const lead = await extractLead(transcript);

    console.log("Lead:", lead);

    await saveToGoogleSheets(lead);

    delete calls[callId];
  }

  res.sendStatus(200);
});

// ---------- Extract ----------
async function extractLead(transcript) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lead",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            location: { type: "string" }
          }
        }
      }
    },
    messages: [
      { role: "system", content: "Extract name and phone (digits only)." },
      { role: "user", content: transcript }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

// ---------- Save ----------
async function saveToGoogleSheets(data) {
  const doc = new GoogleSpreadsheet(process.env.SHEET_ID);

  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  });

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  await sheet.addRow({
    Name: data.name || "",
    Phone: (data.phone || "").replace(/\D/g, ""),
    Timestamp: new Date().toISOString()
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});