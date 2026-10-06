require("dotenv").config();
const express=require("express"), path=require("path"), fs=require("fs"), crypto=require("crypto");
const Database=require("better-sqlite3"), jwt=require("jsonwebtoken"), multer=require("multer");
const {spawn}=require("child_process");

const app=express(), PORT=process.env.PORT||3000;
const DB=process.env.DATABASE_FILE||"./data/studio.db";
const MEDIA=process.env.MEDIA_DIR||"./data/media";
fs.mkdirSync(path.dirname(DB),{recursive:true}); fs.mkdirSync(MEDIA,{recursive:true});
const db=new Database(DB);
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,script TEXT,language TEXT,duration TEXT,aspect TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,project_id TEXT,idx INTEGER,narration TEXT,visual_prompt TEXT,duration INTEGER,status TEXT,asset_url TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,type TEXT,status TEXT,progress INTEGER,message TEXT,created_at TEXT,updated_at TEXT);
`);

app.use(express.json({limit:"20mb"}));
app.use(express.urlencoded({extended:true}));
app.use("/media",express.static(MEDIA));
app.use(express.static(path.join(__dirname,"../public")));

const upload=multer({dest:path.join(MEDIA,"uploads"),limits:{fileSize:100*1024*1024}});
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();

function token(user){return jwt.sign({id:user.id,email:user.email},process.env.JWT_SECRET||"dev-secret",{expiresIn:"7d"});}
function auth(req,res,next){
  const h=req.headers.authorization||"";
  try{req.user=jwt.verify(h.replace(/^Bearer /,""),process.env.JWT_SECRET||"dev-secret");next()}
  catch(e){res.status(401).json({error:"Authentication required"})}
}

app.post("/api/auth/demo",(req,res)=>{
  const email=String(req.body.email||"demo@example.com").trim().toLowerCase();
  let user=db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!user){user={id:uid(),email,name:req.body.name||"Demo User",created_at:now()};db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user.id,user.email,user.name,user.created_at)}
  res.json({token:token(user),user});
});

app.get("/api/me",auth,(req,res)=>res.json(db.prepare("SELECT id,email,name,created_at FROM users WHERE id=?").get(req.user.id)));

app.post("/api/projects",auth,(req,res)=>{
 const p={id:uid(),user_id:req.user.id,name:req.body.name||"Untitled Project",script:req.body.script||"",
 language:req.body.language||"English",duration:req.body.duration||"30 minutes",aspect:req.body.aspect||"16:9",
 status:"draft",created_at:now(),updated_at:now()};
 db.prepare("INSERT INTO projects VALUES(@id,@user_id,@name,@script,@language,@duration,@aspect,@status,@created_at,@updated_at)").run(p);
 res.json(p);
});
app.get("/api/projects",auth,(req,res)=>res.json(db.prepare("SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC").all(req.user.id)));
app.get("/api/projects/:id",auth,(req,res)=>{
 const p=db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
 if(!p)return res.status(404).json({error:"Project not found"});
 p.scenes=db.prepare("SELECT * FROM scenes WHERE project_id=? ORDER BY idx").all(p.id);res.json(p);
});
app.delete("/api/projects/:id",auth,(req,res)=>{
 db.prepare("DELETE FROM scenes WHERE project_id=?").run(req.params.id);
 const r=db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(req.params.id,req.user.id);
 res.json({ok:r.changes>0});
});

function makeScenes(script){
 const a=(script.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[]).map(x=>x.trim()).filter(Boolean);
 const source=a.length?a:["Add a story script to generate scenes."];
 return source.slice(0,100).map((text,i)=>({idx:i+1,narration:text,
 visual_prompt:`Cinematic, coherent visual for: ${text}`,duration:Math.max(5,Math.min(18,Math.ceil(text.split(/\s+/).length/2))),status:"planned"}));
}
app.post("/api/projects/:id/scenes/generate",auth,(req,res)=>{
 const p=db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(req.params.id,req.user.id);
 if(!p)return res.status(404).json({error:"Project not found"});
 db.prepare("DELETE FROM scenes WHERE project_id=?").run(p.id);
 const ins=db.prepare("INSERT INTO scenes VALUES(?,?,?,?,?,?,?,?,?)");
 for(const s of makeScenes(p.script)){ins.run(uid(),p.id,s.idx,s.narration,s.visual_prompt,s.duration,s.status,null)}
 db.prepare("UPDATE projects SET status=?,updated_at=? WHERE id=?").run("scenes_ready",now(),p.id);
 res.json(db.prepare("SELECT * FROM scenes WHERE project_id=? ORDER BY idx").all(p.id));
});

app.post("/api/projects/:id/upload",auth,upload.single("file"),(req,res)=>{
 if(!req.file)return res.status(400).json({error:"No file"});
 res.json({url:"/media/uploads/"+path.basename(req.file.path),filename:req.file.originalname,mime:req.file.mimetype});
});

function job(userId,projectId,type){
 const j={id:uid(),user_id:userId,project_id:projectId,type,status:"queued",progress:0,message:"Queued",created_at:now(),updated_at:now()};
 db.prepare("INSERT INTO jobs VALUES(@id,@user_id,@project_id,@type,@status,@progress,@message,@created_at,@updated_at)").run(j); return j;
}
function runDemoJob(j){
 let p=0; db.prepare("UPDATE jobs SET status=?,message=? WHERE id=?").run("processing","Starting job",j.id);
 const t=setInterval(()=>{p=Math.min(100,p+10);db.prepare("UPDATE jobs SET progress=?,message=?,updated_at=? WHERE id=?").run(p,p<100?"Processing":"Completed",now(),j.id);if(p>=100){db.prepare("UPDATE jobs SET status=? WHERE id=?").run("completed",j.id);clearInterval(t)}},250);
}
app.post("/api/jobs",auth,(req,res)=>{
 const j=job(req.user.id,req.body.projectId||null,req.body.type||"generation");runDemoJob(j);res.status(202).json(j);
});
app.get("/api/jobs/:id",auth,(req,res)=>{const j=db.prepare("SELECT * FROM jobs WHERE id=? AND user_id=?").get(req.params.id,req.user.id);if(!j)return res.status(404).json({error:"Job not found"});res.json(j)});

// Provider adapter contracts. Replace these functions with real provider SDK calls.
const providers={
 llm: async({prompt})=>({configured:!!process.env.LLM_API_KEY,prompt}),
 image: async({prompt})=>({configured:!!process.env.IMAGE_API_KEY,prompt}),
 video: async({prompt})=>({configured:!!process.env.VIDEO_API_KEY,prompt}),
 tts: async({text})=>({configured:!!process.env.TTS_API_KEY,text}),
 music: async({prompt})=>({configured:!!process.env.MUSIC_API_KEY,prompt})
};
app.get("/api/providers",auth,(req,res)=>res.json({
 llm:!!process.env.LLM_API_KEY,image:!!process.env.IMAGE_API_KEY,video:!!process.env.VIDEO_API_KEY,
 tts:!!process.env.TTS_API_KEY,music:!!process.env.MUSIC_API_KEY
}));


// OpenRouter LLM adapter: server-side only. Set OPENROUTER_API_KEY in .env.
async function openRouterChat(messages, model){
  const key=process.env.OPENROUTER_API_KEY;
  if(!key) throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${key}`,
      "Content-Type":"application/json",
      "HTTP-Referer":process.env.APP_URL||`http://localhost:${PORT}`,
      "X-Title":"AI Story Studio"
    },
    body:JSON.stringify({
      model:model||process.env.OPENROUTER_MODEL||"openai/gpt-4o-mini",
      messages,
      temperature:0.7
    })
  });
  if(!response.ok){
    const body=await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0,500)}`);
  }
  const data=await response.json();
  return data.choices?.[0]?.message?.content||"";
}

app.post("/api/ai/script",auth,async(req,res)=>{
  try{
    const prompt=String(req.body.prompt||"");
    if(!prompt) return res.status(400).json({error:"Prompt is required"});
    const text=await openRouterChat([
      {role:"system",content:"You are the script and scene-planning engine for AI Story Studio. Create concise, production-ready narration and visual scene descriptions. Keep character, location and visual style consistent."},
      {role:"user",content:prompt}
    ]);
    res.json({text});
  }catch(e){res.status(502).json({error:e.message});}
});

// FFmpeg render endpoint. It verifies ffmpeg is available and accepts a server-side manifest.
// A production worker should create a validated concat/filter graph and never accept arbitrary shell arguments.
app.post("/api/render",auth,(req,res)=>{
 const j=job(req.user.id,req.body.projectId||null,"render");
 const ff=process.env.FFMPEG_PATH||"ffmpeg";
 const p=spawn(ff,["-version"]); let ok=false;
 p.on("error",()=>{});
 p.stdout.on("data",()=>ok=true);
 p.on("close",code=>{
   if(code===0){db.prepare("UPDATE jobs SET status=?,progress=?,message=? WHERE id=?").run("completed",100,"FFmpeg is available; render worker can assemble validated scene assets.",j.id)}
   else db.prepare("UPDATE jobs SET status=?,message=? WHERE id=?").run("failed","FFmpeg is not available on this server.",j.id);
 });
 res.status(202).json(j);
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
app.listen(PORT,()=>console.log(`AI Story Studio: http://localhost:${PORT}`));
