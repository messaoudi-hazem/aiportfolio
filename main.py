from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import json
import os
import requests
import re
import random

load_dotenv()

app = FastAPI()

# CORS - Allow frontend to connect (localhost for dev, any for prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load your portfolio data
with open('portfolio_data.json', 'r') as f:
    portfolio = json.load(f)

# Groq free API — much faster and reachable on your network
GROQ_TOKEN = os.getenv("GROQ_TOKEN")


def get_local_fallback(message: str, data: dict) -> str:
    msg = message.lower()
    words = set(re.findall(r'\w+', msg))
    
    # 1. Categories & Keywords
    categories = {
        "identity": ["who", "name", "called", "identify", "yourself"],
        "greeting": ["hello", "hi", "hey", "greetings", "morning", "afternoon", "evening", "howdy"],
        "contact": ["contact", "email", "reach", "phone", "number", "linkedin", "github", "hire", "internship"],
        "career": ["career", "profession", "goal", "future", "position", "looking", "intern", "internship"],
        "role": ["job", "role", "title", "occupation", "work", "doing", "student"],
        "projects": ["project", "projects", "build", "portfolio", "application", "app", "code", "software", "formini"],
        "skills": ["skill", "skills", "tech", "language", "framework", "tool", "python", "react", "java", "angular", "stack"],
        "experience": ["experience", "history", "devops", "kubernetes", "docker"],
        "education": ["education", "degree", "university", "college", "study", "esprit", "school"]
    }
    
    # 2. Score each category
    scores = {cat: len(words.intersection(set(keywords))) for cat, keywords in categories.items()}
    best_cat = max(scores, key=scores.get)
    best_score = scores[best_cat]
    
    personal = data.get("personal_information", {})
    summary = data.get("professional_summary", {})
    name = personal.get("name", "Hazem Messaoudi")
    role = personal.get("role", "Software Engineering Student")
    email = personal.get('email', 'not provided')
    phone = personal.get('phone', 'not provided')
    
    if best_score == 0:
        responses = [
            f"{summary.get('description', '')} Feel free to ask about my skills or projects.",
            f"I am a passionate software engineering student specializing in AI. Would you like to hear about my projects?",
            f"I love building intelligent applications! You can ask me about my background, skills, or how to contact me."
        ]
        return random.choice(responses)

    # 3. Generate response based on best matching category
    if best_cat == "identity":
        responses = [
            f"I am {name}, a {role} at {personal.get('school', '')}. I am an AI avatar here to answer any questions about my professional background!",
            f"My name is {name}. I'm currently studying as a {role} and I built this AI portfolio to showcase my work.",
            f"I'm {name}'s AI assistant! He is a {role} passionate about AI and software engineering."
        ]
        return random.choice(responses)
    
    elif best_cat == "greeting":
        responses = [
            f"Hello there! I am {name}'s AI avatar. How can I help you today?",
            f"Hi! Welcome to my intelligent portfolio. What would you like to know about my experience?",
            f"Greetings! I'm an AI representing {name}. Ask me anything about my career goals or technical skills!"
        ]
        return random.choice(responses)
        
    elif best_cat == "contact":
        responses = [
            f"I am based in {personal.get('location', '')}. You can reach me via email at {email} or call me at {phone}!",
            f"I am currently {personal.get('internship_status', '').lower()} Email me at {email} or ring me at {phone}.",
            f"Let's get in touch! My number is {phone} and my email is {email}. I look forward to connecting!"
        ]
        return random.choice(responses)
        
    elif best_cat == "career":
        career_prefs = data.get("career_preferences", {})
        domains = ", ".join(career_prefs.get("preferred_domains", []))
        responses = [
            f"My career goal is to {personal.get('career_goal', '')}. I'm very interested in {domains}.",
            f"I am looking for a 6-month internship! I want to {personal.get('career_goal', '').lower()}",
            f"Professionally, I aim to focus on {domains} and build scalable AI solutions."
        ]
        return random.choice(responses)
        
    elif best_cat == "role":
        responses = [
            f"I am a {personal.get('education_level', '')} studying {personal.get('role', '')}.",
            f"Currently, I am a {role} looking for an internship in software engineering.",
            f"I'm a student focusing heavily on full-stack development and artificial intelligence."
        ]
        return random.choice(responses)
        
    elif best_cat == "projects":
        projs = data.get("projects", [])
        proj_names = [p["name"] for p in projs] if projs else []
        responses = [
            f"I've built several projects, including {', '.join(proj_names)}. Ask me for more details on Formini!",
            f"My main projects include {proj_names[0]} and {proj_names[1]}. They feature AI and full-stack integration.",
            f"I love coding side projects! For example, {proj_names[0]} is an AI-powered platform I worked on."
        ] if len(proj_names) > 1 else ["I have worked on several AI projects."]
        return random.choice(responses)
        
    elif best_cat == "skills":
        tech = data.get("technical_skills", {})
        frontend = ", ".join(tech.get("frontend", []))
        backend = ", ".join(tech.get("backend", []))
        responses = [
            f"My technical skillset is quite broad. For frontend, I use {frontend}. For backend, I use {backend}.",
            f"I'm proficient in {backend} for the backend and {frontend} for the frontend, along with DevOps tools.",
            f"I write code in Python, Java, and TypeScript. I use frameworks like React, Angular, and Spring Boot."
        ]
        return random.choice(responses)
        
    elif best_cat == "experience":
        responses = [
            f"While I am a student, I have solid hands-on experience in DevOps, using Docker and Kubernetes.",
            f"I am actively looking for a 6-month internship to apply my skills in CI/CD pipelines and microservices.",
            f"Through my projects, I've gained practical experience with software architecture and AI model training."
        ]
        return random.choice(responses)
        
    elif best_cat == "education":
        edu = data.get("education", {})
        responses = [
            f"I am currently studying {edu.get('field', '')} at {edu.get('institution', '')}.",
            f"I go to {edu.get('institution', '')} where I learn about {', '.join(edu.get('skills_acquired', [])[:3])}.",
            f"My formal education is in {edu.get('field', '')}, but I do a lot of self-learning in AI and software engineering."
        ]
        return random.choice(responses)

class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
async def chat(request: ChatRequest):
    personal = portfolio.get('personal_information', {})
    tech = portfolio.get('technical_skills', {})
    system_prompt = f"""You are Hazem's AI avatar. You represent Hazem Messaoudi and speak directly in the first person with recruiters and hiring managers.

Here is ALL of Hazem's information — use it freely and accurately:
- Name: {personal.get('name', 'Hazem Messaoudi')}
- Title: {personal.get('role', 'Telecommunications Engineering Student')}
- School: {personal.get('school', 'Esprit School of Engineering Tunisia')}
- Location: {personal.get('location', 'Tunisia')}
- Email: {personal.get('email', 'hazemmessaoudi40@gmail.com')}
- Phone: {personal.get('phone', '+21693043185')}
- Availability: {personal.get('availability', 'Available from June 15')}
- Internship Status: {personal.get('internship_status', 'Looking for a 6-month internship')}
- About: {portfolio.get('professional_summary', {}).get('description', '')}
- Frontend Skills: {', '.join(tech.get('frontend', []))}
- Backend Skills: {', '.join(tech.get('backend', []))}
- DevOps Skills: {', '.join(tech.get('devops', []))}
- Career Goal: {personal.get('career_goal', '')}
- Projects: {', '.join([p['name'] for p in portfolio.get('projects', [])])}

Rules:
1. Always answer in the first person as Hazem ("I", "my", "me").
2. CONTACT INFO: When asked for phone, email, or any contact info, share it IMMEDIATELY and enthusiastically. Example: "Of course! You can reach me at +21693043185 or email me at hazemmessaoudi40@gmail.com."
3. Write in natural conversational spoken English only. No markdown, no bullet points, no asterisks, no headers.
4. Keep responses short and conversational — 1 to 3 sentences maximum.
5. Never invent skills or experiences not listed above. Stick to the facts.
6. If asked about an unknown technology, say you are a fast learner and pivot: "I haven't used that yet, but I pick things up extremely fast. Want to hear about my experience with [related skill] instead?"
"""
    groq_headers = {
        "Authorization": f"Bearer {GROQ_TOKEN}",
        "Content-Type": "application/json"
    }
    
    groq_payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.message}
        ],
        "max_tokens": 200,
        "temperature": 0.7
    }

    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=groq_headers,
            json=groq_payload,
            timeout=15
        )
        print(f"🟡 Groq status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            reply = result["choices"][0]["message"]["content"].strip()
        else:
            print(f"🔴 Groq error: {response.text[:300]}. Falling back.")
            reply = get_local_fallback(request.message, portfolio)
            
    except Exception as e:
        print(f"🔴 Groq API Error: {str(e)}. Falling back to local responder.")
        reply = get_local_fallback(request.message, portfolio)

    return {
        "reply": reply,
        "emotion": "neutral"
    }

# To run: uvicorn main:app --reload --port 8000