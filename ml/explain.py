import os
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI


def build_chain():
    model = os.getenv("GEMINI_MODEL")
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not model or not key:
        raise RuntimeError("Set GEMINI_MODEL and GEMINI_API_KEY in .env")
    llm = ChatGoogleGenerativeAI(model=model, google_api_key=key, temperature=0.4)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a friendly GATE CS tutor. Be accurate and concise."),
        ("human",
         "Topic: {topic}\nDifficulty level: {difficulty} (1 easy, 3 hard)\n"
         "The learner's predicted readiness is {readiness}%.\n\n"
         "Give: (1) a short revision explanation in under 150 words, "
         "(2) three practice MCQs with 4 options each, marking the correct "
         "option with a one-line reason."         "\n\nFormat the answer in Markdown. Do NOT use LaTeX or $ signs; "
         "write grammar rules, formulas and code in plain text or inside "
         "backticks, e.g. `A -> B C`."),
    ])
    return prompt | llm | StrOutputParser()