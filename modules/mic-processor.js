const INPUT_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

class MicProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(BUFFER_SIZE);
        this._fill = 0;
    }

    // Accumulate input samples, downsample to target rate, and post Int16 PCM chunks
    process(inputs) {
        const input = inputs[0]?.[0];
        if (!input) return true;

        // Fill internal buffer chunk by chunk until full
        let srcIdx = 0;
        while (srcIdx < input.length) {
            const space = BUFFER_SIZE - this._fill;
            const toCopy = Math.min(space, input.length - srcIdx);
            this._buffer.set(input.subarray(srcIdx, srcIdx + toCopy), this._fill);
            this._fill += toCopy;
            srcIdx += toCopy;

            // When the buffer is full, downsample and send
            if (this._fill === BUFFER_SIZE) {
                const ratio = sampleRate / INPUT_SAMPLE_RATE; // Native rate / target rate
                const outLen = Math.floor(BUFFER_SIZE / ratio);
                const out = new Int16Array(outLen);

                // Nearest-neighbour downsample and convert Float32 → Int16
                for (let i = 0; i < outLen; i++) {
                    const s = this._buffer[Math.floor(i * ratio)];
                    out[i] = Math.max(-32768, Math.min(32767, s * 32768));
                }

                // Transfer the buffer directly to avoid copying
                this.port.postMessage(out.buffer, [out.buffer]);
                this._fill = 0;
            }
        }

        return true;
    }
}

registerProcessor("mic-processor", MicProcessor);