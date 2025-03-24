const MotionConfig = {
    amplification: 4.0,   // Amplification multiplier
    frameDelay: 100,      // Delay between frames in milliseconds
    maxHistoryFrames: 30   // Maximum frames to store for delay
};

document.getElementById('amplification').addEventListener('input', (e) => {
    MotionConfig.amplification = parseFloat(e.target.value);
});

document.getElementById('delay').addEventListener('input', (e) => {
    MotionConfig.frameDelay = parseInt(e.target.value);
});

navigator.getUserMedia = navigator.getUserMedia ||
                        navigator.webkitGetUserMedia ||
                        navigator.mozGetUserMedia;

if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
}

if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints) {
        return new Promise((resolve, reject) => {
            const legacyGetUserMedia = navigator.getUserMedia ||
                                     navigator.webkitGetUserMedia ||
                                     navigator.mozGetUserMedia;
            
            if (!legacyGetUserMedia) {
                return reject(new Error('getUserMedia not supported'));
            }

            legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
    };
}

async function init() {
    const output = document.getElementById('output');
    const gl = output.getContext('webgl');
    
    // Check WebGL support
    if (!gl) {
        alert("WebGL not supported! Please use a modern browser.");
        return;
    }

    const video = document.createElement('video');
    video.playsInline = true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        }).catch(error => {
            throw new Error(`Camera access denied: ${error.message}`);
        });

        video.srcObject = stream;
        
        // Add iOS compatibility
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('playsinline', true);
        
        await new Promise((resolve) => {
            video.onloadedmetadata = resolve;
            video.play().catch(() => {
                document.body.addEventListener('touchend', () => video.play(), { once: true });
            });
        });
    } catch (err) {
        alert(`Camera error: ${err.message}`);
        return;
    }

    // Shader sources
    const vertexShaderSource = `
        attribute vec4 a_position;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = a_position;
            v_texCoord = (a_position.xy + 1.0) * 0.5;
        }
    `;

    const fragmentShaderSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_current;
        uniform sampler2D u_previous;
        uniform float u_amplification;
        
        void main() {
            vec4 current = texture2D(u_current, v_texCoord);
            vec4 previous = texture2D(u_previous, v_texCoord);
            vec4 difference = current - previous;
            gl_FragColor = clamp(vec4(difference.rgb * u_amplification, 1.0), 0.0, 1.0);
        }
    `;

    // Compile shaders
    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    // Create program
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        return;
    }
    gl.useProgram(program);

    // Set up vertex buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Create textures
    const textures = [];
    for (let i = 0; i < MotionConfig.maxHistoryFrames; i++) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        textures.push(texture);
    }

    // Get uniform locations
    const amplificationLocation = gl.getUniformLocation(program, 'u_amplification');

    // Main render loop
    let currentTextureIndex = 0;
    function render() {
        if (!video.videoWidth || !video.videoHeight) {
            requestAnimationFrame(render);
            return;
        }

        // Update canvas size to match video
        if (output.width !== video.videoWidth || output.height !== video.videoHeight) {
            output.width = video.videoWidth;
            output.height = video.videoHeight;
            gl.viewport(0, 0, output.width, output.height);
        }

        // Calculate previous frame index based on delay
        const delayFrames = Math.min(
            Math.floor(MotionConfig.frameDelay / (1000/60)), // 60 FPS assumption
            MotionConfig.maxHistoryFrames - 1
        );
        const previousIndex = (currentTextureIndex - delayFrames + MotionConfig.maxHistoryFrames) % MotionConfig.maxHistoryFrames;

        // Upload current video frame to texture
        gl.bindTexture(gl.TEXTURE_2D, textures[currentTextureIndex]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

        // Set uniforms
        gl.uniform1i(gl.getUniformLocation(program, 'u_current'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_previous'), 1);
        gl.uniform1f(amplificationLocation, MotionConfig.amplification);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[currentTextureIndex]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[previousIndex]);

        // Draw to screen
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Update texture index
        currentTextureIndex = (currentTextureIndex + 1) % MotionConfig.maxHistoryFrames;
        requestAnimationFrame(render);
    }

    render();
}

// Start the app
init().catch(err => console.error('Initialization error:', err));