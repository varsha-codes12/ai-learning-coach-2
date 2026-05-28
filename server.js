require("dotenv").config();
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const pdfParse = require("pdf-parse-fixed");
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const USERS_FILE = "./users.json";

// helper
function getUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* REGISTER */
app.post("/register", (req, res) => {
  const { username, password } = req.body;

  let users = getUsers();

  if (users[username]) {
    return res.json({ success: false, message: "User already exists" });
  }

  users[username] = {
    password,
    history: []
  };

  saveUsers(users);

  res.json({ success: true, message: "Registered successfully" });
});

/* LOGIN */
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  let users = getUsers();

  if (!users[username]) {
    return res.json({ success: false, message: "User not found. Please register." });
  }

  if (users[username].password !== password) {
    return res.json({ success: false, message: "Wrong password" });
  }

  res.json({ success: true, message: "Login success" });
});

app.post("/create-workspace", (req, res) => {
    let { username, workspace } = req.body;

    let users = getUsers();

  // 1. check user
    if (!users[username]) {
        return res.json({ success: false, message: "User not found" });
    }

  // 2. ensure workspaces object exists
    if (!users[username].workspaces) {
        users[username].workspaces = {};
    }

  // 3. check duplicate
    if (users[username].workspaces[workspace]) {
        return res.json({ success: false, message: "Workspace already exists" });
    }

  // 4. create workspace dynamically
    users[username].workspaces[workspace] = {
        files: [],
        notes: "",
        quiz: "",
        timetable: ""
     };

    saveUsers(users);

    res.json({
        success: true,
        message: "Workspace created",
        workspace
    });
});
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});
const upload = multer({ storage });

// PDF UPLOAD INTO WORKSPACE
app.post("/upload-pdf", upload.single("pdf"), (req, res) => {
    let { username, workspace } = req.body;

    let users = getUsers();

  // STEP 1: ensure user exists
    if (!users[username]) {
        return res.json({ success: false, message: "User not found" });
    }

  // STEP 2: auto-create workspaces object if missing
    if (!users[username].workspaces) {
        return res.json({ success: false, message: "No workspaces found" });
    }

  // STEP 3: check workspace exists
    if (!users[username].workspaces[workspace]) {
        return res.json({ success: false, message: "Workspace not found" });
    }

  // STEP 4: ensure files array exists
    if (!users[username].workspaces[workspace].files) {
        users[username].workspaces[workspace].files = [];
    }

  // STEP 5: store file
    users[username].workspaces[workspace].files.push(req.file.filename);

    saveUsers(users);

    res.json({
        success: true,
        message: "Uploaded successfully",
        file: req.file.filename
    });
});

app.post("/delete-workspace", (req, res) => {
    let { username, workspace } = req.body;

    let users = getUsers();

    if (users[username]?.workspaces?.[workspace]) {
        delete users[username].workspaces[workspace];
        saveUsers(users);

        return res.json({ success: true });
    }

    res.json({ success: false, message: "Workspace not found" });
});
app.get("/get-workspaces", (req, res) => {
    let { username } = req.query;

    let users = getUsers();

    if (!users[username]) {
        return res.json({ workspaces: {} });
    }

    res.json({
        workspaces: users[username].workspaces || {}
    });
});

app.post("/generate-quiz-from-workspace", async (req, res) => {
    try {
    
        let { username, workspace } = req.body;

        let users = getUsers();

        if (!users?.[username]) {
            return res.json({ success: false, message: "User not found" });
        }

        let ws = users[username].workspaces?.[workspace];

        if (!ws) {
            return res.json({ success: false, message: "Workspace not found" });
        }

        if (!ws.files || ws.files.length === 0) {
            return res.json({ success: false, message: "No PDF uploaded in workspace" });
        }

    // take latest uploaded file
        let latestFile = ws.files[ws.files.length - 1];

        const pdfPath = path.join(__dirname, "uploads", latestFile);
        const dataBuffer = fs.readFileSync(pdfPath);

        const pdfData = await pdfParse(dataBuffer);

        const text = pdfData.text || "";
        const prompt = `
Create 15 MCQ questions from this text.
Mix easy, medium, hard.

Return ONLY JSON:
[
  {
    "question": "",
    "options": ["A","B","C","D"],
    "answer": "actual correct option text"
  }
]

TEXT:
${text}
`;

        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "openai/gpt-4o-mini",
                messages: [{ role: "user", content: prompt }]
            },
            {
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    let content = response.data.choices[0].message.content;
    content = content 
        .replace(/```json/g,"")
        .replace(/```/g,"")
        .trim();
    let quiz;

    try {
        quiz = JSON.parse(content);
    } catch (e) {
        console.log("AI returned invalid JSON:", content);
        return res.json({
            success: false,
            message: "AI returned invalid quiz format. Try again."
        });
    }

    res.json({ success: true, quiz });

    } catch (err) {
    console.log(err);
    res.json({ success: false, message: "Quiz generation failed" });
    }
});

app.post("/generate-summary", async (req, res) => {

    try{

        let { username, workspace } = req.body;

        let users = getUsers();

        let ws =
            users[username]?.workspaces?.[workspace];

        if(!ws){

            return res.json({
                success:false,
                message:"Workspace not found"
            });
        }

        if(!ws.files || ws.files.length === 0){

            return res.json({
                success:false,
                message:"No PDF uploaded"
            });
        }

        let latestFile =
            ws.files[ws.files.length - 1];

        const pdfPath =
            path.join(__dirname,
            "uploads",
            latestFile);  

        const dataBuffer =
            fs.readFileSync(pdfPath);

        const pdfData = await pdfParse(dataBuffer);   
        
        const text =
            pdfData.text;

        const prompt = `

Generate beautiful study notes in proper HTML format.

Rules:

- Use ONLY HTML
- Use:
  <h1> for title
  <h2> for headings
  <p> for explanations
  <ul><li> for points
- Keep notes neat and structured
- Add spacing between sections
- Notes should look like real study notes
- Do NOT use markdown
- Do NOT use **
- Do NOT explain JavaScript slice
- Generate notes only from PDF content

PDF CONTENT:

${text}

`;

        const response = await axios.post(

            "https://openrouter.ai/api/v1/chat/completions",

            {
                model: "openai/gpt-4o-mini",

                messages:[
                    {
                        role:"user",
                        content:prompt
                    }
                ]
            },

            {
                headers:{
                    "Authorization":
                    `Bearer ${process.env.OPENROUTER_API_KEY}`,

                    "Content-Type":
                    "application/json"
                }
            }
        );

        let notes =
            response.data.choices[0].message.content;
            notes = notes
            .replace(/```html/g, "")
            .replace(/```/g, "");
        if(!users[username].savedNotes){

            users[username].savedNotes = [];
        }

        users[username].savedNotes.push({

            id: Date.now(),

            title: workspace + " Summary",

            content: notes
        });

        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(users, null, 2)
        );
        res.json({
            success:true,
            notes
        });

    }catch(err){

        console.log(err);

        res.json({
            success:false,
            message:"Summary generation failed"
        });
    }
});

app.post("/get-saved-notes", (req,res)=>{

    let { username } = req.body;

    let users = getUsers();

    let notes =
        users[username]?.savedNotes || [];

    res.json({ notes });
});

app.post("/open-note", (req,res)=>{

    let { username, id } = req.body;

    let users = getUsers();

    let note =
        users[username]?.savedNotes
        ?.find(n => n.id == id);

    res.json({
        content: note.content
    });
});

app.post("/delete-note", (req,res)=>{

    let { username, id } = req.body;

    let users = getUsers();

    users[username].savedNotes =
        users[username].savedNotes
        .filter(n => n.id != id);

    fs.writeFileSync(
        USERS_FILE,
        JSON.stringify(users, null, 2)
    );

    res.json({
        success:true
    });
});

app.post("/generate-timetable", async(req,res)=>{

try{

    let {
        username,
        workspace,
        startDate,
        endDate
    } = req.body;

    let users = getUsers();

    let ws =
    users[username]
    ?.workspaces?.[workspace];

    if(!ws){

        return res.json({
            success:false,
            message:"Workspace not found"
        });
    }

    let latestFile =
    ws.files[ws.files.length - 1];

    let pdfPath = path.join(
        __dirname,
        "uploads",
        latestFile
    );

    const dataBuffer =
    fs.readFileSync(pdfPath);

    const pdfData =
    await pdfParse(dataBuffer);

    const text =
    pdfData.text;

    const prompt = `

Generate a beautiful HTML study timetable.

Rules:
- Use date format as DD-MM-YYYY
- Create timetable from ${startDate} to ${endDate}
- Divide topics properly
- Add revision days
- Add study hours
- Use ONLY HTML
- Use proper headings
- Use colorful clean table structure
- Use:
<h1>
<h2>
<table>
<tr>
<th>
<td>
<ul>
<li>

- Make timetable very easy to understand
- Make output look like real study planner
- Do NOT use markdown
- Do NOT use \`\`\`

PDF CONTENT:

${text}

`;

    const response = await axios.post(

        "https://openrouter.ai/api/v1/chat/completions",

        {
            model:"openai/gpt-4o-mini",

            messages:[
                {
                    role:"user",
                    content:prompt
                }
            ]
        },

        {
            headers:{
                "Authorization":
                `Bearer ${process.env.OPENROUTER_API_KEY}`,

                "Content-Type":
                "application/json"
            }
        }
    );

    let timetable =
    response.data.choices[0].message.content;

    timetable = timetable
    .replace(/```html/g,"")
    .replace(/```/g,"");

    if(!users[username].savedTimetables){

        users[username].savedTimetables = [];
    }

    users[username].savedTimetables.push({

        id: Date.now(),

        title: workspace + " Timetable",

        content: timetable
    });

    saveUsers(users);

    res.json({
        success:true,
        timetable
    });

}catch(err){

    console.log(err);

    res.json({
        success:false,
        message:"Timetable generation failed"
    });
}

});

app.post("/get-saved-timetables", (req,res)=>{

    let { username } = req.body;

    let users = getUsers();

    let timetables =
    users[username]?.savedTimetables || [];

    res.json({ timetables });
});

app.post("/open-timetable", (req,res)=>{

    let { username, id } = req.body;

    let users = getUsers();

    let timetable =
    users[username]?.savedTimetables
    ?.find(t => t.id == id);

    res.json({
        content: timetable.content
    });
});

app.post("/delete-timetable", (req,res)=>{

    let { username, id } = req.body;

    let users = getUsers();

    users[username].savedTimetables =
    users[username].savedTimetables
    .filter(t => t.id != id);

    saveUsers(users);

    res.json({
        success:true
    });
});
const PORT = process.env.PORT || 3000;
app.listen(3000, () => {
  console.log(`Server running on port ${PORT}`);
});