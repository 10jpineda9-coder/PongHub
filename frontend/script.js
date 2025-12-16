// ==================== CONFIGURACIÓN INICIAL ====================

// Elementos del DOM
const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');
const socket = io('http://localhost:5000');

// Configuración del juego
const GAME_CONFIG = {
    paddleWidth: 10,
    paddleHeight: 60,
    ballSize: 10,
    ballSpeed: { x: 5, y: 3 },
    maxScore: 11,
    winningDifference: 2
};

// Estado del juego
let gameState = {
    playerScore: 0,
    opponentScore: 0,
    ballX: 0,
    ballY: 0,
    playerPaddleY: 0,
    opponentPaddleY: 0,
    gameActive: false,
    gamePaused: false,
    gameMode: 'single', // 'single', 'multiplayer', 'local'
    aiDifficulty: 'medium',
    leftPlayerUp: false,
    leftPlayerDown: false,
    rightPlayerUp: false,
    rightPlayerDown: false,
    touchControls: {
        left: { active: false, y: 0 },
        right: { active: false, y: 0 }
    }
};

// Sistema de logros
let achievements = [];
let userStats = { gamesPlayed: 0, gamesWon: 0, achievementPoints: 0 };

// ==================== INICIALIZACIÓN ====================

// Redimensionar canvas
function resizeCanvas() {
    const isMobile = window.innerWidth <= 768;
    const maxWidth = isMobile ? window.innerWidth * 0.95 : 800;
    const maxHeight = isMobile ? window.innerHeight * 0.6 : 400;
    
    canvas.width = maxWidth;
    canvas.height = maxHeight;
    
    // Mostrar controles táctiles en móviles
    document.querySelector('.touch-controls').style.display = isMobile ? 'flex' : 'none';
    
    // Reiniciar posiciones
    if (gameState.gameMode !== 'multiplayer') {
        resetGamePositions();
    }
}

// Inicializar posiciones
function resetGamePositions() {
    gameState.playerPaddleY = (canvas.height - GAME_CONFIG.paddleHeight) / 2;
    gameState.opponentPaddleY = (canvas.height - GAME_CONFIG.paddleHeight) / 2;
    resetBall();
}

// Reiniciar pelota
function resetBall() {
    gameState.ballX = canvas.width / 2;
    gameState.ballY = canvas.height / 2;
    const direction = Math.random() > 0.5 ? 1 : -1;
    
    // Ajustar velocidad según dificultad
    let speedMultiplier = 1;
    switch(gameState.aiDifficulty) {
        case 'easy': speedMultiplier = 0.8; break;
        case 'hard': speedMultiplier = 1.2; break;
    }
    
    gameState.ballSpeedX = direction * GAME_CONFIG.ballSpeed.x * speedMultiplier;
    gameState.ballSpeedY = (Math.random() * 2 - 1) * GAME_CONFIG.ballSpeed.y * speedMultiplier;
}

// ==================== CONTROL DE JUEGO ====================

// Actualizar lógica del juego
function updateGame() {
    if (!gameState.gameActive || gameState.gamePaused) return;

    // Actualizar posición de la pelota
    gameState.ballX += gameState.ballSpeedX;
    gameState.ballY += gameState.ballSpeedY;

    // Rebote en paredes superior e inferior
    if (gameState.ballY <= 0 || gameState.ballY >= canvas.height) {
        gameState.ballSpeedY = -gameState.ballSpeedY;
    }

    // Puntos
    if (gameState.ballX <= 0) {
        gameState.opponentScore++;
        checkGameEnd();
        resetBall();
    } else if (gameState.ballX >= canvas.width) {
        gameState.playerScore++;
        checkGameEnd();
        resetBall();
    }

    // Rebote en paletas
    if (gameState.ballX <= GAME_CONFIG.paddleWidth && 
        gameState.ballY >= gameState.playerPaddleY && 
        gameState.ballY <= gameState.playerPaddleY + GAME_CONFIG.paddleHeight) {
        
        gameState.ballSpeedX = Math.abs(gameState.ballSpeedX) * 1.05; // Aumentar velocidad
        const hitPos = (gameState.ballY - gameState.playerPaddleY) / GAME_CONFIG.paddleHeight;
        gameState.ballSpeedY = (hitPos - 0.5) * 8;
    }

    if (gameState.ballX >= canvas.width - GAME_CONFIG.paddleWidth && 
        gameState.ballY >= gameState.opponentPaddleY && 
        gameState.ballY <= gameState.opponentPaddleY + GAME_CONFIG.paddleHeight) {
        
        gameState.ballSpeedX = -Math.abs(gameState.ballSpeedX) * 1.05;
        const hitPos = (gameState.ballY - gameState.opponentPaddleY) / GAME_CONFIG.paddleHeight;
        gameState.ballSpeedY = (hitPos - 0.5) * 8;
    }

    // Actualizar paletas según modo de juego
    updatePaddles();

    // Actualizar marcador en DOM
    updateScoreDisplay();
}

// Actualizar paletas
function updatePaddles() {
    const paddleSpeed = 8;
    
    // Modo un jugador
    if (gameState.gameMode === 'single') {
        updateAI();
        
        // Control del jugador (teclado)
        if (gameState.leftPlayerUp) {
            gameState.playerPaddleY = Math.max(0, gameState.playerPaddleY - paddleSpeed);
        }
        if (gameState.leftPlayerDown) {
            gameState.playerPaddleY = Math.min(
                canvas.height - GAME_CONFIG.paddleHeight, 
                gameState.playerPaddleY + paddleSpeed
            );
        }
    }
    
    // Modo local (dos jugadores en la misma máquina)
    else if (gameState.gameMode === 'local') {
        if (gameState.leftPlayerUp) {
            gameState.playerPaddleY = Math.max(0, gameState.playerPaddleY - paddleSpeed);
        }
        if (gameState.leftPlayerDown) {
            gameState.playerPaddleY = Math.min(
                canvas.height - GAME_CONFIG.paddleHeight, 
                gameState.playerPaddleY + paddleSpeed
            );
        }
        if (gameState.rightPlayerUp) {
            gameState.opponentPaddleY = Math.max(0, gameState.opponentPaddleY - paddleSpeed);
        }
        if (gameState.rightPlayerDown) {
            gameState.opponentPaddleY = Math.min(
                canvas.height - GAME_CONFIG.paddleHeight, 
                gameState.opponentPaddleY + paddleSpeed
            );
        }
    }
    
    // Modo multijugador online
    else if (gameState.gameMode === 'multiplayer') {
        // Enviar posición al servidor
        socket.emit('paddle_move', { 
            y: gameState.playerPaddleY,
            gameId: currentGameId 
        });
    }
    
    // Control táctil (prioridad sobre teclado)
    if (gameState.touchControls.left.active) {
        gameState.playerPaddleY = Math.max(0, Math.min(
            canvas.height - GAME_CONFIG.paddleHeight,
            gameState.touchControls.left.y - GAME_CONFIG.paddleHeight / 2
        ));
    }
    if (gameState.touchControls.right.active) {
        gameState.opponentPaddleY = Math.max(0, Math.min(
            canvas.height - GAME_CONFIG.paddleHeight,
            gameState.touchControls.right.y - GAME_CONFIG.paddleHeight / 2
        ));
    }
}

// ==================== IA DEL OPONENTE ====================

function updateAI() {
    if (gameState.gameMode !== 'single') return;
    
    const aiCenter = gameState.opponentPaddleY + GAME_CONFIG.paddleHeight / 2;
    const ballPrediction = gameState.ballY + (gameState.ballX - canvas.width / 2) * 0.3;
    
    let reactionSpeed, accuracy, errorRange;
    
    // Configurar dificultad
    switch(gameState.aiDifficulty) {
        case 'easy':
            reactionSpeed = 0.03;
            accuracy = 0.6;
            errorRange = 100;
            break;
        case 'medium':
            reactionSpeed = 0.05;
            accuracy = 0.8;
            errorRange = 50;
            break;
        case 'hard':
            reactionSpeed = 0.08;
            accuracy = 0.95;
            errorRange = 20;
            break;
    }
    
    // Añadir error aleatorio basado en la dificultad
    const error = (Math.random() - 0.5) * errorRange * (1 - accuracy);
    const targetY = ballPrediction + error;
    
    // Suavizar movimiento hacia la posición objetivo
    if (aiCenter < targetY - 5) {
        gameState.opponentPaddleY += (targetY - aiCenter) * reactionSpeed;
    } else if (aiCenter > targetY + 5) {
        gameState.opponentPaddleY -= (aiCenter - targetY) * reactionSpeed;
    }
    
    // Mantener dentro de los límites
    gameState.opponentPaddleY = Math.max(
        0, 
        Math.min(canvas.height - GAME_CONFIG.paddleHeight, gameState.opponentPaddleY)
    );
}

// ==================== RENDERIZADO ====================

function drawGame() {
    // Limpiar canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Dibujar fondo
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Dibujar línea central punteada
    ctx.beginPath();
    ctx.setLineDash([5, 15]);
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Dibujar paletas
    ctx.fillStyle = '#4cc9f0';
    ctx.fillRect(
        0, 
        gameState.playerPaddleY, 
        GAME_CONFIG.paddleWidth, 
        GAME_CONFIG.paddleHeight
    );
    
    ctx.fillStyle = '#f72585';
    ctx.fillRect(
        canvas.width - GAME_CONFIG.paddleWidth, 
        gameState.opponentPaddleY, 
        GAME_CONFIG.paddleWidth, 
        GAME_CONFIG.paddleHeight
    );
    
    // Dibujar pelota
    ctx.beginPath();
    ctx.arc(gameState.ballX, gameState.ballY, GAME_CONFIG.ballSize, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    
    // Sombra de la pelota
    ctx.beginPath();
    ctx.arc(gameState.ballX - 3, gameState.ballY - 3, GAME_CONFIG.ballSize, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    
    // Dibujar marcador en el canvas (opcional)
    ctx.font = 'bold 40px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.textAlign = 'center';
    ctx.fillText(gameState.playerScore, canvas.width / 4, 50);
    ctx.fillText(gameState.opponentScore, 3 * canvas.width / 4, 50);
}

// ==================== CONTROLES ====================

// Control por teclado
document.addEventListener('keydown', (e) => {
    switch(e.key.toLowerCase()) {
        case 'w':
            gameState.leftPlayerUp = true;
            break;
        case 's':
            gameState.leftPlayerDown = true;
            break;
        case 'arrowup':
            gameState.rightPlayerUp = true;
            break;
        case 'arrowdown':
            gameState.rightPlayerDown = true;
            break;
        case ' ':
            togglePause();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    switch(e.key.toLowerCase()) {
        case 'w':
            gameState.leftPlayerUp = false;
            break;
        case 's':
            gameState.leftPlayerDown = false;
            break;
        case 'arrowup':
            gameState.rightPlayerUp = false;
            break;
        case 'arrowdown':
            gameState.rightPlayerDown = false;
            break;
    }
});

// Control táctil
function setupTouchControls() {
    const leftArea = document.querySelector('.left-area');
    const rightArea = document.querySelector('.right-area');
    
    leftArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        gameState.touchControls.left.active = true;
        gameState.touchControls.left.y = touch.clientY;
    });
    
    leftArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (gameState.touchControls.left.active) {
            const touch = e.touches[0];
            gameState.touchControls.left.y = touch.clientY;
        }
    });
    
    leftArea.addEventListener('touchend', (e) => {
        gameState.touchControls.left.active = false;
    });
    
    // Configurar área derecha similarmente
    rightArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        gameState.touchControls.right.active = true;
        gameState.touchControls.right.y = touch.clientY;
    });
    
    rightArea.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (gameState.touchControls.right.active) {
            const touch = e.touches[0];
            gameState.touchControls.right.y = touch.clientY;
        }
    });
    
    rightArea.addEventListener('touchend', (e) => {
        gameState.touchControls.right.active = false;
    });
}

// ==================== SISTEMA DE AUTENTICACIÓN ====================

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.sessionId = localStorage.getItem('session_id');
    }
    
    async login(username, password) {
        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.currentUser = data.user_data;
                this.sessionId = data.session_id;
                localStorage.setItem('session_id', this.sessionId);
                showNotification('¡Bienvenido!', 'success');
                showGameScreen();
                loadUserData();
                return true;
            } else {
                showNotification(data.error || 'Error en el login', 'error');
                return false;
            }
        } catch (error) {
            showNotification('Error de conexión', 'error');
            return false;
        }
    }
    
    async register(username, password, confirmPassword) {
        if (password !== confirmPassword) {
            showNotification('Las contraseñas no coinciden', 'error');
            return false;
        }
        
        try {
            const response = await fetch('/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showNotification('¡Registro exitoso! Ahora inicia sesión', 'success');
                showLoginForm();
                return true;
            } else {
                showNotification(data.error || 'Error en el registro', 'error');
                return false;
            }
        } catch (error) {
            showNotification('Error de conexión', 'error');
            return false;
        }
    }
    
    async checkAuth() {
        if (!this.sessionId) return false;
        
        try {
            const response = await fetch('/auth/user/profile', {
                headers: { 'Cookie': `session_id=${this.sessionId}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user_data;
                showGameScreen();
                loadUserData();
                return true;
            }
        } catch (error) {
            console.error('Error verificando autenticación:', error);
        }
        
        return false;
    }
    
    logout() {
        localStorage.removeItem('session_id');
        this.currentUser = null;
        this.sessionId = null;
        showAuthScreen();
        showNotification('Sesión cerrada', 'info');
    }
}

const authManager = new AuthManager();

// ==================== MULTIJUGADOR CON WEBSOCKETS ====================

let currentGameId = null;
let opponentName = 'Oponente';

// Conectar al servidor de juego
socket.on('connect', () => {
    console.log('Conectado al servidor de juego');
});

// Unirse a partida multijugador
function joinMultiplayerGame() {
    if (!authManager.currentUser && !confirm('¿Jugar como invitado? No se guardarán tus estadísticas.')) {
        return;
    }
    
    const playerName = authManager.currentUser?.username || 'Invitado';
    socket.emit('join_game', { 
        player_name: playerName,
        session_id: authManager.sessionId 
    });
    
    showStatusMessage('waiting-opponent');
}

// Manejar eventos del servidor
socket.on('waiting_for_opponent', () => {
    showStatusMessage('waiting-opponent');
});

socket.on('game_start', (data) => {
    currentGameId = data.game_id;
    opponentName = data.opponent;
    gameState.gameMode = 'multiplayer';
    gameState.gameActive = true;
    hideStatusMessages();
    showNotification(`Partida contra ${opponentName} iniciada`, 'success');
    updatePlayerInfo();
});

socket.on('game_state', (state) => {
    if (gameState.gameMode !== 'multiplayer') return;
    
    // Sincronizar estado del juego
    gameState.playerPaddleY = state.paddle1_y;
    gameState.opponentPaddleY = state.paddle2_y;
    gameState.ballX = state.ball_x;
    gameState.ballY = state.ball_y;
    gameState.playerScore = state.score1;
    gameState.opponentScore = state.score2;
});

socket.on('opponent_disconnected', () => {
    showNotification('Oponente desconectado', 'warning');
    leaveMultiplayerGame();
});

// ==================== SISTEMA DE LOGROS ====================

class AchievementSystem {
    constructor() {
        this.achievements = [
            {
                id: 'first_game',
                name: 'Primera Partida',
                description: 'Completa tu primera partida',
                icon: '🎮',
                points: 10,
                unlocked: false
            },
            {
                id: 'first_win',
                name: 'Primera Victoria',
                description: 'Gana tu primera partida',
                icon: '🏆',
                points: 50,
                unlocked: false
            },
            {
                id: 'score_10',
                name: 'Anotador Experto',
                description: 'Alcanza 10 puntos en una partida',
                icon: '⭐',
                points: 30,
                unlocked: false
            },
            {
                id: 'comeback_king',
                name: 'Rey de la Remontada',
                description: 'Gana estando 5 puntos abajo',
                icon: '🔥',
                points: 75,
                unlocked: false
            },
            {
                id: 'multiplayer_master',
                name: 'Maestro Multijugador',
                description: 'Gana 10 partidas online',
                icon: '👥',
                points: 100,
                unlocked: false,
                progress: 0,
                target: 10
            }
        ];
    }
    
    checkAchievements() {
        const unlocked = [];
        
        // Verificar logros según el estado del juego
        this.achievements.forEach(achievement => {
            if (!achievement.unlocked) {
                let shouldUnlock = false;
                
                switch(achievement.id) {
                    case 'first_game':
                        shouldUnlock = userStats.gamesPlayed >= 1;
                        break;
                    case 'first_win':
                        shouldUnlock = userStats.gamesWon >= 1;
                        break;
                    case 'score_10':
                        shouldUnlock = gameState.playerScore >= 10 || gameState.opponentScore >= 10;
                        break;
                    case 'multiplayer_master':
                        achievement.progress = userStats.multiplayerWins || 0;
                        shouldUnlock = achievement.progress >= achievement.target;
                        break;
                }
                
                if (shouldUnlock) {
                    this.unlockAchievement(achievement.id);
                    unlocked.push(achievement);
                }
            }
        });
        
        return unlocked;
    }
    
    unlockAchievement(achievementId) {
        const achievement = this.achievements.find(a => a.id === achievementId);
        if (achievement && !achievement.unlocked) {
            achievement.unlocked = true;
            achievement.unlockedAt = new Date();
            userStats.achievementPoints += achievement.points;
            showAchievementNotification(achievement);
            saveAchievements();
        }
    }
    
    async saveAchievements() {
        if (!authManager.sessionId) return;
        
        try {
            await fetch('/achievements/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': `session_id=${authManager.sessionId}`
                },
                body: JSON.stringify({
                    achievements: this.achievements,
                    stats: userStats
                })
            });
        } catch (error) {
            console.error('Error guardando logros:', error);
        }
    }
    
    loadAchievements(data) {
        if (data) {
            this.achievements = data.achievements || this.achievements;
            userStats = data.stats || userStats;
        }
        renderAchievements();
    }
}

const achievementSystem = new AchievementSystem();

// ==================== FUNCIONES AUXILIARES ====================

function showNotification(message, type = 'info') {
    const notificationArea = document.getElementById('notification-area');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    notificationArea.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function showAchievementNotification(achievement) {
    const notificationArea = document.getElementById('notification-area');
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.innerHTML = `
        <div style="font-size: 2rem;">${achievement.icon}</div>
        <div>
            <strong>¡Logro Desbloqueado!</strong><br>
            ${achievement.name} (+${achievement.points}pts)
        </div>
    `;
    
    notificationArea.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

function updateScoreDisplay() {
    document.getElementById('player-score').textContent = gameState.playerScore;
    document.getElementById('opponent-score').textContent = gameState.opponentScore;
}

function togglePause() {
    gameState.gamePaused = !gameState.gamePaused;
    document.getElementById('pause-btn').innerHTML = gameState.gamePaused ? 
        '<i class="fas fa-play"></i> Continuar' : 
        '<i class="fas fa-pause"></i> Pausa';
    
    if (gameState.gamePaused) {
        showStatusMessage('game-paused');
    } else {
        hideStatusMessages();
    }
}

function checkGameEnd() {
    if (gameState.playerScore >= GAME_CONFIG.maxScore && 
        gameState.playerScore - gameState.opponentScore >= GAME_CONFIG.winningDifference) {
        endGame(true);
    } else if (gameState.opponentScore >= GAME_CONFIG.maxScore && 
               gameState.opponentScore - gameState.playerScore >= GAME_CONFIG.winningDifference) {
        endGame(false);
    }
}

function endGame(playerWon) {
    gameState.gameActive = false;
    userStats.gamesPlayed++;
    if (playerWon) userStats.gamesWon++;
    
    showNotification(
        playerWon ? '¡Has ganado!' : '¡Has perdido!',
        playerWon ? 'success' : 'error'
    );
    
    achievementSystem.checkAchievements();
    updateStatsDisplay();
    
    // En modo multijugador, dejar la partida
    if (gameState.gameMode === 'multiplayer') {
        setTimeout(() => leaveMultiplayerGame(), 3000);
    }
}

// ==================== INTERFAZ DE USUARIO ====================

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('game-screen').classList.add('hidden');
}

function showGameScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    updatePlayerInfo();
}

function showLoginForm() {
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
}

function showRegisterForm() {
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
}

function updatePlayerInfo() {
    const username = authManager.currentUser?.username || 'Invitado';
    document.getElementById('username-display').textContent = username;
    
    const modeText = gameState.gameMode === 'multiplayer' ? 
        `vs ${opponentName}` : 
        (gameState.gameMode === 'single' ? 'vs IA' : 'Local');
    document.getElementById('game-mode-display').textContent = modeText;
}

function showStatusMessage(type) {
    document.querySelectorAll('.status-message').forEach(el => {
        el.classList.add('hidden');
    });
    document.getElementById(type)?.classList.remove('hidden');
}

function hideStatusMessages() {
    document.querySelectorAll('.status-message').forEach(el => {
        el.classList.add('hidden');
    });
}

// ==================== EVENT LISTENERS ====================

document.addEventListener('DOMContentLoaded', () => {
    // Inicialización
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupTouchControls();
    
    // Verificar autenticación al cargar
    authManager.checkAuth();
    
    // Formulario de login
    document.getElementById('login-btn').addEventListener('click', () => {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        authManager.login(username, password);
    });
    
    // Formulario de registro
    document.getElementById('register-btn').addEventListener('click', () => {
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;
        authManager.register(username, password, confirm);
    });
    
    // Cambiar entre formularios
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        showRegisterForm();
    });
    
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        showLoginForm();
    });
    
    // Jugar como invitado
    document.getElementById('guest-play').addEventListener('click', () => {
        showGameScreen();
    });
    
    // Modos de juego
    document.getElementById('single-player-btn').addEventListener('click', () => {
        gameState.gameMode = 'single';
        updateGameModeButtons('single-player-btn');
        updatePlayerInfo();
    });
    
    document.getElementById('multiplayer-btn').addEventListener('click', () => {
        gameState.gameMode = 'multiplayer';
        updateGameModeButtons('multiplayer-btn');
        joinMultiplayerGame();
    });
    
    document.getElementById('local-multiplayer-btn').addEventListener('click', () => {
        gameState.gameMode = 'local';
        updateGameModeButtons('local-multiplayer-btn');
        updatePlayerInfo();
    });
    
    // Dificultad
    document.getElementById('difficulty-select').addEventListener('change', (e) => {
        gameState.aiDifficulty = e.target.value;
    });
    
    // Controles del juego
    document.getElementById('start-btn').addEventListener('click', () => {
        gameState.gameActive = true;
        if (gameState.gameMode === 'multiplayer') {
            socket.emit('game_start', { gameId: currentGameId });
        }
    });
    
    document.getElementById('pause-btn').addEventListener('click', togglePause);
    
    document.getElementById('reset-btn').addEventListener('click', () => {
        gameState.playerScore = 0;
        gameState.opponentScore = 0;
        gameState.gameActive = false;
        resetGamePositions();
        updateScoreDisplay();
        hideStatusMessages();
    });
    
    // Logros
    document.getElementById('achievements-btn').addEventListener('click', () => {
        document.getElementById('achievements-panel').classList.remove('hidden');
        renderAchievements();
    });
    
    document.getElementById('close-achievements').addEventListener('click', () => {
        document.getElementById('achievements-panel').classList.add('hidden');
    });
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        authManager.logout();
    });
    
    // Bucle principal del juego
    function gameLoop() {
        updateGame();
        drawGame();
        requestAnimationFrame(gameLoop);
    }
    
    gameLoop();
});

function updateGameModeButtons(activeButtonId) {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(activeButtonId).classList.add('active');
}

function renderAchievements() {
    const list = document.getElementById('achievements-list');
    list.innerHTML = '';
    
    achievementSystem.achievements.forEach(achievement => {
        const item = document.createElement('div');
        item.className = `achievement-item ${achievement.unlocked ? 'unlocked' : 'locked'}`;
        
        let progressHTML = '';
        if (achievement.progress !== undefined) {
            const progress = Math.min(100, (achievement.progress / achievement.target) * 100);
            progressHTML = `
                <div class="achievement-progress">
                    <div class="progress-bar" style="width: ${progress}%"></div>
                </div>
                <small>${achievement.progress}/${achievement.target}</small>
            `;
        }
        
        item.innerHTML = `
            <div class="achievement-icon">${achievement.icon}</div>
            <div class="achievement-info">
                <div class="achievement-name">${achievement.name}</div>
                <div class="achievement-desc">${achievement.description}</div>
                ${progressHTML}
                <div class="achievement-points">${achievement.points} puntos</div>
            </div>
        `;
        
        list.appendChild(item);
    });
    
    // Actualizar estadísticas
    document.getElementById('games-played').textContent = userStats.gamesPlayed;
    document.getElementById('games-won').textContent = userStats.gamesWon;
    document.getElementById('achievement-points').textContent = userStats.achievementPoints;
}

function updateStatsDisplay() {
    document.getElementById('games-played').textContent = userStats.gamesPlayed;
    document.getElementById('games-won').textContent = userStats.gamesWon;
    document.getElementById('achievement-points').textContent = userStats.achievementPoints;
}

function loadUserData() {
    if (authManager.currentUser) {
        achievementSystem.loadAchievements(authManager.currentUser.achievements);
        userStats = authManager.currentUser.stats || userStats;
        updateStatsDisplay();
    }
}

function leaveMultiplayerGame() {
    gameState.gameMode = 'single';
    gameState.gameActive = false;
    currentGameId = null;
    opponentName = 'Oponente';
    resetGamePositions();
    updateGameModeButtons('single-player-btn');
    updatePlayerInfo();
  }
