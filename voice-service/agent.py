"""Constructs the Strands BidiAgent backed by Amazon Nova Sonic v2."""

import os

from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel

from tools import AUDIO_SAMPLE_RATE, get_note, search_notes

_SYSTEM_PROMPT = """\
You are a knowledgebase assistant for a personal Zettelkasten note system.
When the user asks a question, use search_notes to find relevant notes, then \
get_note to read full content if needed.
Always cite the note titles you used to answer. Keep answers concise and \
conversational — this is a voice interface.\
"""

_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "amazon.nova-sonic-v2:0")
_VOICE_NAME = os.getenv("NOVA_SONIC_VOICE", "matthew")
_VAD_SENSITIVITY = os.getenv("NOVA_SONIC_VAD_SENSITIVITY", "LOW")
_MAX_TOKENS = int(os.getenv("NOVA_SONIC_MAX_TOKENS", "2048"))
_TEMPERATURE = float(os.getenv("NOVA_SONIC_TEMPERATURE", "0.7"))


def create_agent() -> BidiAgent:
    """Create and return a configured BidiAgent instance."""
    region = os.getenv("AWS_REGION", "us-east-1")

    model = BidiNovaSonicModel(
        model_id=_MODEL_ID,
        provider_config={
            "audio": {
                "input_rate": AUDIO_SAMPLE_RATE,
                "output_rate": AUDIO_SAMPLE_RATE,
                "voice": _VOICE_NAME,
            },
            "turn_detection": {
                "endpointingSensitivity": _VAD_SENSITIVITY,
            },
            "inference": {
                "max_tokens": _MAX_TOKENS,
                "temperature": _TEMPERATURE,
            },
        },
        client_config={
            "region": region,
        },
    )

    return BidiAgent(
        model=model,
        tools=[search_notes, get_note],
        system_prompt=_SYSTEM_PROMPT,
    )
