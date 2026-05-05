# Amazon Nova 2 Sonic Python Streaming Implementation

This repository contains Python scripts that implement real-time audio streaming applications integrating with Amazon Nova 2 Sonic model. These implementations enable natural conversational interactions through a command-line interface while leveraging Amazon's powerful Nova 2 Sonic model for processing and generating responses.

## Available Implementations

This repository includes four different implementations of the Nova 2 Sonic model:

1. **nova_sonic_simple.py**: A basic implementation that demonstrates how events are structured in the bidirectional streaming API. This version does not support barge-in functionality (interrupting the assistant while it's speaking) and does not implement true bidirectional communication.

2. **nova_sonic.py**: The full-featured implementation with real bidirectional communication and barge-in support. This allows for more natural conversations where users can interrupt the assistant while it's speaking, similar to human conversations.

3. **nova_sonic_tool_use.py**: An advanced implementation that extends the bidirectional communication capabilities with tool use examples. This version demonstrates how Nova 2 Sonic can interact with external tools and APIs to provide enhanced functionality.

4. **nova_sonic_with_text.py**: Extends the bidirectional implementation with flexible input modes — text-only, audio-only, or mixed (simultaneous audio and text). Useful for testing without a microphone or for sending typed messages alongside speech.

## Features

- Real-time audio streaming from your microphone to AWS Bedrock
- Bidirectional communication with Nova 2 Sonic model
- Audio playback of Nova 2 Sonic responses
- Simple console-based interface showing transcripts
- Support for debug mode with verbose logging
- Barge-in capability (in nova_sonic.py, nova_sonic_tool_use.py, and nova_sonic_with_text.py)
- Tool use integration examples (in nova_sonic_tool_use.py and nova_sonic_with_text.py)
- Text, audio, and mixed input modes (in nova_sonic_with_text.py)

## Prerequisites

- Python 3.12
- AWS Account with Bedrock access
- AWS CLI configured with appropriate credentials
- Working microphone and speakers

## Installation

1. Create and activate a virtual environment:

```bash
# On Linux
python3 -m venv .venv
source .venv/bin/activate

# On Windows PowerShell
python -m venv .venv-win
.venv-win\Scripts\activate
```

2. Install all dependencies:

```bash
python -m pip install -r requirements.txt --force-reinstall
```

3. Configure AWS credentials:

The application uses environment variables for AWS authentication. Set these before running the application:

```bash
# On Linux
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-west-2"

# On Windows PowerShell
$env:AWS_ACCESS_KEY_ID="your-access-key"
$env:AWS_SECRET_ACCESS_KEY="your-secret-key"
$env:AWS_DEFAULT_REGION="us-west-2"
```

## Usage

Activate the virtual environment first if not already active:

```bash
# On Linux
source .venv/bin/activate

# On Windows PowerShell
.venv-win\Scripts\activate
```

Run any of the scripts in standard mode:

```bash
# Basic implementation (no barge-in, great start to understand event structure)
python nova_sonic_simple.py

# Full implementation with bidirectional communication and barge-in
python nova_sonic.py

# Advanced implementation with tool use examples
python nova_sonic_tool_use.py

# Text, audio, and mixed input modes
python nova_sonic_with_text.py --mode text   # text input only
python nova_sonic_with_text.py --mode audio  # audio input only (default)
python nova_sonic_with_text.py --mode mixed  # audio + text simultaneously
```

Or with debug mode for verbose logging:

```bash
python nova_sonic.py --debug
python nova_sonic_with_text.py --debug
```

### How it works

1. When you run the script, it will:
   - Connect to AWS Bedrock
   - Initialize a streaming session
   - Start capturing audio from your microphone
   - Stream the audio to the Nova 2 Sonic model
   - Play back audio responses through your speakers
   - Display transcripts in the console

2. During the conversation:
   - Your speech will be transcribed and shown as "User: [transcript]"
   - The Nova 2 Sonic's responses will be shown as "Assistant: [response]"
   - Audio responses will be played through your speakers

3. To end the conversation:
   - Press Enter at any time
   - The script will properly close the connection and exit

## Implementation Details

### nova_sonic_simple.py
This implementation provides a basic example of how to interact with the bidirectional streaming API. It:
- Demonstrates the event structure used by Nova 2 Sonic
- Provides a simple one-way communication flow
- Does not support barge-in (interrupting the assistant)
- Does not implement true bidirectional communication
- Useful for understanding the fundamentals of the API

### nova_sonic.py
This is the full-featured implementation that:
- Supports true bidirectional communication
- Implements barge-in functionality allowing users to interrupt the assistant
- Provides a more natural conversational experience
- Handles audio streaming in both directions simultaneously
- Includes improved error handling and session management

### nova_sonic_tool_use.py
This advanced implementation extends the bidirectional capabilities with:
- Tool use examples showing how Nova 2 Sonic can interact with external tools
- Demonstrates how to structure tool use requests and handle responses
- Shows integration patterns for enhancing Nova 2 Sonic with additional capabilities
- Includes examples of practical tool integrations

### nova_sonic_with_text.py
This implementation extends `nova_sonic.py` with flexible input modes:
- `--mode audio` (default): standard microphone input with barge-in support
- `--mode text`: reads input from stdin; a `SilentAudioStreamer` sends zeroed-out PCM to keep the audio content block alive
- `--mode mixed`: combines live mic input with concurrent stdin text input
- Includes tool use support (same pattern as `nova_sonic_tool_use.py`)
- Useful for testing without a microphone or for sending structured text prompts alongside speech

## Customization

You can modify the following parameters in the scripts:

- `SAMPLE_RATE`: Audio sample rate (default: 16000 Hz for input, 24000 Hz for output)
- `CHANNELS`: Number of audio channels (default: 1)
- `CHUNK_SIZE`: Audio buffer size (varies by implementation)

You can also customize the system prompt by modifying the `default_system_prompt` variable in the `initialize_stream` method.

## Troubleshooting

1. **Audio Input Issues**
   - Ensure your microphone is properly connected and selected as the default input device
   - Try increasing the chunk size if you experience audio stuttering
   - If you encounter issues with PyAudio installation:

      **On Ubuntu/Debian:**

      ```bash
      sudo apt-get install portaudio19-dev
      ```

      **On Windows:** 

      ```bash
      # Install PyAudio binary directly using pip
      pip install pipwin
      pipwin install pyaudio
      ```

      Alternatively, Windows users can download pre-compiled PyAudio wheels from:
      https://www.lfd.uci.edu/~gohlke/pythonlibs/#pyaudio
      ```bash
      # Example for Python 3.12, 64-bit Windows
      pip install PyAudio‑0.2.11‑cp312‑cp312‑win_amd64.whl
      ```

2. **Audio Output Issues**
   - Verify your speakers are working and not muted
   - Check that the audio output device is properly selected

3. **AWS Connection Issues**
   - Verify your AWS credentials are correctly configured as environment variables
   - Ensure you have access to the AWS Bedrock service
   - Check your internet connection

4. **Debug Mode**
   - Run with the `--debug` flag to see detailed logs
   - This can help identify issues with the connection or audio processing

## Data Flow

```
User Speech → PyAudio → Amazon Nova 2 Sonic Model → Audio Output
     ↑                                                      ↓
     └──────────────────────────────────────────────────────┘
                          Conversation
```

For tool use implementation, the flow extends to:

```
User Speech → PyAudio → Amazon Nova 2 Sonic Model → Tool Execution → Audio Output
     ↑                                                                      ↓
     └──────────────────────────────────────────────────────────────────────┘
                                  Conversation
```

## Known Limitation
> **Warning:** Use a headset for testing, as a known issue with PyAudio affects its handling of echo. You may experience unexpected interruptions if running the samples with open speakers.
