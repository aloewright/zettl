const BASE_URL = 'https://api.elevenlabs.io/v1'

export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM' // Rachel — neutral, clear

export interface VoiceSettings {
  stability?: number        // 0–1, default 0.5
  similarity_boost?: number // 0–1, default 0.75
  style?: number            // 0–1, default 0
  use_speaker_boost?: boolean
  speed?: number            // 0.7–1.2, default 1.0
}

export interface Voice {
  voice_id: string
  name: string
  category: string
  description?: string
  preview_url?: string
}

export class ElevenLabsClient {
  constructor(private readonly apiKey: string) {}

  private headers() {
    return {
      'xi-api-key': this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  /** Convert text to speech. Returns raw audio bytes (mp3). */
  async textToSpeech(
    text: string,
    voiceId = DEFAULT_VOICE_ID,
    settings: VoiceSettings = {},
    outputFormat = 'mp3_44100_128',
  ): Promise<ArrayBuffer> {
    const res = await fetch(
      `${BASE_URL}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: settings.stability ?? 0.5,
            similarity_boost: settings.similarity_boost ?? 0.75,
            style: settings.style ?? 0,
            use_speaker_boost: settings.use_speaker_boost ?? true,
            speed: settings.speed ?? 1.0,
          },
        }),
      },
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ElevenLabs error ${res.status}: ${text}`)
    }

    return res.arrayBuffer()
  }

  /** List available voices for the account. */
  async listVoices(): Promise<Voice[]> {
    const res = await fetch(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    })
    if (!res.ok) throw new Error(`ElevenLabs error ${res.status}`)
    const data = await res.json() as { voices: Voice[] }
    return data.voices
  }
}
