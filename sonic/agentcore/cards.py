# Imports
import asyncio
import json
import logging
import os
import re
import time
import boto3
from botocore.config import Config

# Initializations
logger = logging.getLogger(__name__)
CARDS_MODEL_ID = os.environ.get("CARDS_MODEL_ID", "us.anthropic.claude-sonnet-5-5") # Not Sonic, which only handles the conversation. The only model that invented no facts in testing; faster ones made things up
REGION = "us-west-2"
MAX_CARDS_PER_TURN = 2
MAX_ITEMS_PER_CARD = 5
LANGUAGES = {"en": "English", "pt": "Brazilian Portuguese"} # Page language from the client's config
_client = None

# Canonical links: the only URLs a card may carry, so a model can never invent or redirect one
LINKS = {
    "mailto:hello@guiruggiero.com": "email",
    "https://linkedin.com/in/guiruggiero": "LinkedIn profile",
    "https://github.com/guiruggiero": "GitHub profile",
    "https://guiruggiero.com/resume": "resume page",
    "https://guiruggiero.com/projects": "projects page",
    "https://guiruggiero.com/scheduling": "meeting booking page",
    "https://aws.amazon.com/ai/generative-ai/nova/speech/": "Amazon Nova Sonic product page",
} # Labels only name the link - any fact here ends up on cards

# One card per kind, with fixed titles per language (mirrors the Sonic prompt's KB sections)
KINDS = {
    "contact": {"en": "How to get in touch", "pt": "Como entrar em contato", "holds": "ways to reach Gui"},
    "current-role": {"en": "Current role", "pt": "Cargo atual", "holds": "his job today and what he works on"},
    "career": {"en": "Career path", "pt": "Trajetória profissional", "holds": "his past jobs and experience"},
    "education": {"en": "Education", "pt": "Formação", "holds": "his studies"},
    "sports": {"en": "Sports", "pt": "Esportes", "holds": "any sport or physical activity, done or watched, and athletes he follows"},
    "travel": {"en": "Places and travel", "pt": "Lugares e viagens", "holds": "places he's from, has lived in or visited"},
    "interests": {"en": "Interests", "pt": "Interesses", "holds": "hobbies and passions that aren't a sport, a physical activity or about places"},
    "fun-facts": {"en": "Fun facts", "pt": "Curiosidades", "holds": "trivia and personal quirks"},
    "glossary": {"en": "Glossary", "pt": "Glossário", "holds": "terms GuiPT explained"},
    "other": {"en": "More about Gui", "pt": "Mais sobre o Gui", "holds": "anything else concrete about Gui"},
} # Where a fact goes, never which facts to expect - listed examples got filled in with made-up facts

SYSTEM_PROMPT = f"""You maintain a visual board next to a voice conversation between a website visitor and GuiPT, a voice assistant that talks about Gui Ruggiero. The visitor hears GuiPT; the board shows only the key takeaways from what GuiPT just said, so they can be read, clicked and kept.

GuiPT's reply reaches you one sentence at a time: each request has the visitor's last message, GuiPT's reply so far (it may continue in the next request) and the cards already on the board. Call show_cards with the cards to add or update. Work only from what's there - later sentences come in later requests.

The board has one card per kind:
{chr(10).join(f"- {kind}: {spec['holds']}" for kind, spec in KINDS.items())}
These say where a fact goes. They are not a checklist: a card only ever holds facts GuiPT said in this conversation. When a fact fits two kinds, use the more specific one, whatever the visitor asked (a sport goes on sports even in an answer about hobbies).

When to make a card:
- For any concrete fact about Gui: contact details, roles and companies, products, projects, education, sports, places, interests, trivia and fun facts, terms explained, dates, numbers, links
- Numbers are concrete facts and always deserve a card: years of experience, durations, team sizes, counts and dates. Write them as digits ("about 40", not "about forty"), otherwise exactly as GuiPT said them - never calculate, convert or round a number yourself (a start date stays a start date)
- Return no cards for greetings, small talk, questions back to the visitor, clarifications, apologies, or anything already fully on the board (don't resend an unchanged card). If everything in the reply is already on the board, return no cards
- At most {MAX_CARDS_PER_TURN} cards per request, usually one, and never put the same fact on two cards

How to write a card:
- Written form, never spoken form: "26" not "twenty six", "hello@guiruggiero.com" not "hello at gui ruggiero dot com", "speech-to-speech" not "speech to speech", "PM" or "Principal Product Manager" as fits. Gui's handle is one word, "guiruggiero"
- kind: the card it belongs on, from the list above. To add to a card already on the board, return that whole card: its existing items plus the new ones. When it's full, keep the most relevant {MAX_ITEMS_PER_CARD}
- items: 1 to {MAX_ITEMS_PER_CARD} entries, each a short text (a name, value or fact - not a sentence), an optional detail (a tagline of at most one short sentence), and an optional url
- Each item is one fact as a short phrase in GuiPT's words, at most 8 words, with no "Label:" prefix. Related values said together stay in one item
- detail is optional, at most 12 words, and only when it adds something - never repeat the text or another item's detail
- An item's text is the value itself, readable without the link: "hello@guiruggiero.com", "LinkedIn: guiruggiero" - never just a label like "Email"
- A contact card has one item per channel GuiPT named - email, LinkedIn or GitHub, each with its URL. Only the channels GuiPT named
- url must be copied exactly from the list below, and only when the item is that thing; otherwise leave it out. Never make up a URL
- Use only facts GuiPT actually said in this reply or that are on the board - never add your own knowledge
- Write in the language given with each request

Allowed URLs:
{chr(10).join(f"- {url} = {description}" for url, description in LINKS.items())}

Always answer by calling show_cards, with an empty list when nothing is worth showing. Never reply with text."""

TOOL_CONFIG = {
    "tools": [{
        "toolSpec": {
            "name": "show_cards",
            "description": "Add or update cards on the visitor's board. Pass an empty list when nothing is worth showing.",
            "inputSchema": {"json": {
                "type": "object",
                "properties": {
                    "cards": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string", "enum": list(KINDS)},
                                "items": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "text": {"type": "string"},
                                            "detail": {"type": "string"},
                                            "url": {"type": "string"},
                                        },
                                        "required": ["text"],
                                    },
                                },
                            },
                            "required": ["kind", "items"],
                        },
                    },
                },
                "required": ["cards"],
            }},
        },
    }],
    "toolChoice": {"auto": {}}, # Sonnet 5.5 rejects a forced tool choice, the prompt asks for the call instead
}

def _get_client():
    # One client per container, short timeouts so a slow call can't hold cards back
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=REGION, config=Config(connect_timeout=3, read_timeout=10, retries={"max_attempts": 2, "mode": "standard"}))
    return _client

# Trim to a length on a word boundary, so a long item ends in "…" instead of half a word
def _trim(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"

# Keep only well-formed cards, trimmed, with allowlisted URLs; the kind is the card's ID and sets its title
def _clean_card(raw, lang: str = "en") -> dict | None:
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind") if raw.get("kind") in KINDS else "other"

    items = []
    for raw_item in raw.get("items") or []:
        if not isinstance(raw_item, dict) or not str(raw_item.get("text", "")).strip():
            continue
        item = {"text": _trim(str(raw_item["text"]).strip(), 80)}
        detail = str(raw_item.get("detail") or "").strip()
        if detail:
            item["detail"] = _trim(detail, 120)
        url = str(raw_item.get("url") or "").strip()
        if url in LINKS:
            item["url"] = url
        elif url:
            logger.warning("Dropped a card URL outside the allowlist")
        items.append(item)
        if len(items) == MAX_ITEMS_PER_CARD:
            break

    if not items:
        return None
    return {"id": kind, "kind": kind, "title": KINDS[kind].get(lang, KINDS[kind]["en"]), "items": items}

# One model call: last exchange plus the current board in, cleaned cards out
def extract_cards(user_text: str, assistant_text: str, board: list[dict], lang: str = "en") -> list[dict]:
    board_json = json.dumps([{"kind": card["kind"], "items": card["items"]} for card in board], ensure_ascii=False)
    message = f"Language: {LANGUAGES.get(lang, LANGUAGES['en'])}\n\nBoard:\n{board_json}\n\nVisitor:\n{user_text or '(nothing, GuiPT spoke first)'}\n\nGuiPT so far:\n{assistant_text}"

    response = _get_client().converse(
        modelId=CARDS_MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}, {"cachePoint": {"type": "default"}}], # Tools and system prompt are the same on every call, cached
        messages=[{"role": "user", "content": [{"text": message}]}],
        toolConfig=TOOL_CONFIG,
        inferenceConfig={"maxTokens": 600}, # Sonnet 5.5 rejects non-default sampling parameters
        additionalModelRequestFields={"thinking": {"type": "between_tools"}, "output_config": {"effort": "low"}}, # Closest to thinking off, which Sonnet 5.5 rejects
    )

    for block in response["output"]["message"]["content"]:
        if "toolUse" in block:
            raw_cards = block["toolUse"]["input"].get("cards") or []
            cards = [card for card in (_clean_card(raw, lang) for raw in raw_cards[:MAX_CARDS_PER_TURN]) if card]
            return list({card["id"]: card for card in cards}.values()) # Two cards of one kind: the last wins
    logger.warning("Card extraction answered with text instead of a show_cards call")
    return []

# Pushes cards as GuiPT speaks, sentence by sentence, without blocking the conversation
class CardBoard:
    def __init__(self, send_fn, lang: str = "en"):
        self._send_fn = send_fn
        self._lang = lang if lang in LANGUAGES else "en"
        self._user_text = []
        self._new_exchange = True # The next visitor message starts a new exchange, replacing the last one's
        self._reply = [] # Current response's sentences so far
        self._responses = 0 # bidi_response_stop count; the client counts the same frames, so (response, sentence) keys match
        self._response_open = False
        self._interrupted = False # The visitor cut the current reply off, its later sentences are ignored
        self._epoch = 0 # Bumped on every barge-in, so a queued or in-flight extraction knows to drop its cards
        self._board = {} # kind → card, insertion order is the board order
        self._pending = None # Latest queued extraction; a newer sentence replaces it, since it carries the whole reply
        self._wake = asyncio.Event()
        self._worker = asyncio.create_task(self._run())

    # Typed text and the first message never come back as transcripts
    def on_visitor_text(self, text: str):
        text = (text or "").strip()
        if not text:
            return
        if self._new_exchange:
            self._user_text, self._new_exchange = [], False
        self._user_text.append(text)

    # Fed every event after the name respelling, so cards read "Gui"
    def on_event(self, event: dict):
        event_type = event.get("type")
        if event_type == "bidi_response_start":
            self._response_open = True
        elif event_type == "bidi_barge_in":
            # Drops whatever hasn't been sent; sent cards stay
            self._interrupted = self._response_open
            self._epoch += 1
            self._pending = None
        elif event_type == "bidi_transcript_delta" and event.get("role") == "assistant":
            self._reply.append(event.get("delta") or "") # Counted even if interrupted or empty, to stay in step with the client
            if not self._interrupted:
                self._queue()
        elif event_type == "bidi_transcript_block" and event.get("role") == "user":
            self.on_visitor_text(event.get("transcript"))
        elif event_type == "bidi_response_stop":
            self._responses += 1
            self._response_open = self._interrupted = False
            self._reply = []
            self._new_exchange = True

    # Ask for cards from the reply so far, keyed to its latest sentence
    def _queue(self):
        reply = " ".join(sentence.strip() for sentence in self._reply if sentence.strip())
        if not reply:
            return
        self._pending = {"user": " ".join(self._user_text), "reply": reply, "response": self._responses, "sentence": len(self._reply), "epoch": self._epoch}
        self._wake.set()

    # One extraction at a time, in order, so each sees the cards before it
    async def _run(self):
        while True:
            await self._wake.wait()
            self._wake.clear()
            request, self._pending = self._pending, None
            if request is None or request["epoch"] != self._epoch:
                continue
            started = time.monotonic()
            try:
                cards = await asyncio.to_thread(extract_cards, request["user"], request["reply"], list(self._board.values()), self._lang)
            except Exception as e:
                # Cards are an extra, the conversation goes on without them
                logger.warning("Card extraction failed: %s: %s (user %d chars, reply %d chars)", type(e).__name__, e, len(request["user"]), len(request["reply"]))
                continue
            if request["epoch"] != self._epoch:
                logger.info("Reply interrupted during extraction, card skipped")
                continue
            sent = 0
            for card in cards:
                if self._board.get(card["id"]) == card:
                    continue # Unchanged, nothing new to show
                self._board.pop(card["id"], None) # Updated cards move to the end, newest
                self._board[card["id"]] = card
                await self._send_fn({"type": "card", "card": card, "response": request["response"], "sentence": request["sentence"]})
                sent += 1
            logger.info("Cards: %d sent for sentence %d.%d in %.2fs", sent, request["response"], request["sentence"], time.monotonic() - started)

    def close(self):
        self._worker.cancel()