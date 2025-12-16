from flask import Flask, request, jsonify, session, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import random
import uuid
import json
import os
import hashlib
from datetime import datetime

# Configuración
app = Flask(__name__, static_folder='../frontend')
app.config['SECRET_KEY'] = 'pong-secret-key-2024'
app.config['SESSION_TYPE'] = 'filesystem'
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Archivos de almacenamiento
USERS_FILE = 'users.json'
ACHIEVEMENTS_FILE = 'achievements.json'

# Estructuras de datos en memoria
games = {}
players = {}
waiting_players = []
active_sessions = {}

# Clase para manejar el juego
class PongGame:
    def __init__(self, game_id, player1_id, player1_name):
        self.game_id = game_id
        self.player1 = {
            'id': player1_id,
            'name': player1_name,
            'score': 0,
            'paddle_y': 170
        }
        self.player2 = None
        self.ball_x = 400
        self.ball_y = 200
        self.ball_speed_x = 5 * random.choice([-1, 1])
        self.ball_speed_y = 3 * random.random()
        self.game_active = False
        self.last_update = datetime.now()
        
    def add_player(self, player_id, player_name):
        self.player2 = {
            'id': player_id,
            'name': player_name,
            'score': 0,
            'paddle_y': 170
        }
        self.game_active = True
        
    def update_ball(self):
        current_time = datetime.now()
        delta = (current_time - self.last_update).total_seconds()
        self.last_update = current_time
        
        # Ajustar por tiempo real
        self.ball_x += self.ball_speed_x * delta * 60
        self.ball_y += self.ball_speed_y * delta * 60
        
        # Rebote en paredes
        if self.ball_y <= 0 or self.ball_y >= 400:
            self.ball_speed_y = -self.ball_speed_y
            
        # Puntos
        if self.ball_x <= 0:
            self.player2['score'] += 1
            self.reset_ball()
            return 'player2'
        elif self.ball_x >= 800:
            self.player1['score'] += 1
            self.reset_ball()
            return 'player1'
            
        # Rebote en paletas
        paddle_width = 10
        paddle_height = 60
        
        # Paleta del jugador 1 (izquierda)
        if (self.ball_x <= paddle_width and 
            self.player1['paddle_y'] <= self.ball_y <= self.player1['paddle_y'] + paddle_height):
            self.ball_speed_x = abs(self.ball_speed_x) * 1.05
            hit_pos = (self.ball_y - self.player1['paddle_y']) / paddle_height
            self.ball_speed_y = (hit_pos - 0.5) * 8
            
        # Paleta del jugador 2 (derecha)
        if (self.ball_x >= 800 - paddle_width and 
            self.player2 and 
            self.player2['paddle_y'] <= self.ball_y <= self.player2['paddle_y'] + paddle_height):
            self.ball_speed_x = -abs(self.ball_speed_x) * 1.05
            hit_pos = (self.ball_y - self.player2['paddle_y']) / paddle_height
            self.ball_speed_y = (hit_pos - 0.5) * 8
            
        return None
        
    def reset_ball(self):
        self.ball_x = 400
        self.ball_y = 200
        self.ball_speed_x = 5 * random.choice([-1, 1])
        self.ball_speed_y = 3 * random.random()
        
    def get_state(self):
        return {
            'paddle1_y': self.player1['paddle_y'],
            'paddle2_y': self.player2['paddle_y'] if self.player2 else 170,
            'ball_x': self.ball_x,
            'ball_y': self.ball_y,
            'score1': self.player1['score'],
            'score2': self.player2['score'] if self.player2 else 0
        }

# Funciones para manejar usuarios
def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=2)

def load_achievements():
    if os.path.exists(ACHIEVEMENTS_FILE):
        with open(ACHIEVEMENTS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_achievements(achievements_data):
    with open(ACHIEVEMENTS_FILE, 'w') as f:
        json.dump(achievements_data, f, indent=2)

# Rutas de autenticación
@app.route('/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': 'Usuario y contraseña requeridos'}), 400
    
    if len(username) < 3:
        return jsonify({'error': 'Usuario debe tener al menos 3 caracteres'}), 400
    
    if len(password) < 6:
        return jsonify({'error': 'Contraseña debe tener al menos 6 caracteres'}), 400
    
    users = load_users()
    
    if username in users:
        return jsonify({'error': 'Usuario ya existe'}), 400
    
    # Hash de contraseña
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    
    # Crear usuario
    users[username] = {
        'password_hash': password_hash,
        'created_at': datetime.now().isoformat(),
        'stats': {
            'games_played': 0,
            'games_won': 0,
            'multiplayer_wins': 0,
            'achievement_points': 0
        },
        'achievements': []
    }
    
    save_users(users)
    
    # Crear logros iniciales
    achievements_data = load_achievements()
    achievements_data[username] = {
        'unlocked': [],
        'in_progress': {}
    }
    save_achievements(achievements_data)
    
    return jsonify({'message': 'Usuario registrado exitosamente'}), 201

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': 'Usuario y contraseña requeridos'}), 400
    
    users = load_users()
    user = users.get(username)
    
    if not user or user['password_hash'] != hashlib.sha256(password.encode()).hexdigest():
        return jsonify({'error': 'Credenciales inválidas'}), 401
    
    # Crear sesión
    session_id = str(uuid.uuid4())
    session[session_id] = {
        'username': username,
        'login_time': datetime.now().isoformat()
    }
    active_sessions[session_id] = username
    
    # Cargar logros del usuario
    achievements_data = load_achievements()
    user_achievements = achievements_data.get(username, {'unlocked': [], 'in_progress': {}})
    
    response = jsonify({
        'message': 'Login exitoso',
        'session_id': session_id,
        'user_data': {
            'username': username,
            'stats': user['stats'],
            'achievements': user_achievements
        }
    })
    
    response.set_cookie('session_id', session_id, max_age=3600*24*7, httponly=True, samesite='Lax')
    return response

@app.route('/auth/logout', methods=['POST'])
def logout():
    session_id = request.cookies.get('session_id')
    if session_id in session:
        del session[session_id]
    if session_id in active_sessions:
        del active_sessions[session_id]
    return jsonify({'message': 'Logout exitoso'})

@app.route('/auth/user/profile')
def get_profile():
    session_id = request.cookies.get('session_id')
    user_session = session.get(session_id)
    
    if not user_session:
        return jsonify({'error': 'No autenticado'}), 401
    
    users = load_users()
    user_data = users.get(user_session['username'])
    
    if not user_data:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    
    # Cargar logros
    achievements_data = load_achievements()
    user_achievements = achievements_data.get(user_session['username'], {'unlocked': [], 'in_progress': {}})
    
    return jsonify({
        'username': user_session['username'],
        'user_data': {
            'stats': user_data['stats'],
            'achievements': user_achievements
        }
    })

# Ruta para actualizar logros
@app.route('/achievements/update', methods=['POST'])
def update_achievements():
    session_id = request.cookies.get('session_id')
    user_session = session.get(session_id)
    
    if not user_session:
        return jsonify({'error': 'No autenticado'}), 401
    
    data = request.get_json()
    username = user_session['username']
    
    # Actualizar logros
    achievements_data = load_achievements()
    if username not in achievements_data:
        achievements_data[username] = {'unlocked': [], 'in_progress': {}}
    
    # Guardar logros desbloqueados
    if 'achievements' in data:
        # Aquí procesarías los logros recibidos
        pass
    
    save_achievements(achievements_data)
    
    # Actualizar estadísticas del usuario
    users = load_users()
    if username in users and 'stats' in data:
        users[username]['stats'] = data['stats']
        save_users(users)
    
    return jsonify({'message': 'Logros actualizados'})

# Servir archivos estáticos
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)

# WebSocket events
@socketio.on('connect')
def handle_connect():
    print(f'Cliente conectado: {request.sid}')
    # Verificar sesión
    session_id = request.args.get('session_id') or request.cookies.get('session_id')
    if session_id and session_id in session:
        username = session[session_id]['username']
        players[request.sid] = {
            'id': request.sid,
            'name': username,
            'game_id': None,
            'session_id': session_id
        }
    else:
        # Jugador invitado
        players[request.sid] = {
            'id': request.sid,
            'name': f'Invitado-{request.sid[:8]}',
            'game_id': None,
            'session_id': None
        }

@socketio.on('disconnect')
def handle_disconnect():
    player = players.get(request.sid)
    if player:
        # Si está en espera, eliminarlo
        if request.sid in waiting_players:
            waiting_players.remove(request.sid)
        
        # Si está en un juego, notificar al oponente
        if player['game_id']:
            game = games.get(player['game_id'])
            if game:
                opponent_id = game.player2['id'] if game.player1['id'] == request.sid else game.player1['id']
                emit('opponent_disconnected', room=opponent_id)
                del games[game.game_id]
        
        del players[request.sid]
    
    print(f'Cliente desconectado: {request.sid}')

@socketio.on('join_game')
def handle_join_game(data):
    player_id = request.sid
    player = players.get(player_id)
    
    if not player:
        emit('error', {'message': 'Jugador no encontrado'})
        return
    
    player_name = data.get('player_name', player['name'])
    
    if waiting_players:
        # Unir a juego existente
        opponent_id = waiting_players.pop(0)
        opponent = players.get(opponent_id)
        
        if not opponent:
            # Si el oponente ya no está, volver a poner en espera
            waiting_players.append(player_id)
            emit('waiting_for_opponent')
            return
        
        # Crear nuevo juego
        game_id = str(uuid.uuid4())
        game = PongGame(game_id, opponent_id, opponent['name'])
        game.add_player(player_id, player_name)
        
        games[game_id] = game
        player['game_id'] = game_id
        opponent['game_id'] = game_id
        
        # Unir a ambos jugadores a la sala
        join_room(game_id, player_id)
        join_room(game_id, opponent_id)
        
        # Notificar inicio del juego
        emit('game_start', {
            'game_id': game_id,
            'opponent': opponent['name'],
            'player_number': 2
        }, room=player_id)
        
        emit('game_start', {
            'game_id': game_id,
            'opponent': player_name,
            'player_number': 1
        }, room=opponent_id)
        
        # Enviar estado inicial
        emit('game_state', game.get_state(), room=game_id)
        
    else:
        # Poner en lista de espera
        waiting_players.append(player_id)
        player['game_id'] = None
        emit('waiting_for_opponent')

@socketio.on('paddle_move')
def handle_paddle_move(data):
    player_id = request.sid
    player = players.get(player_id)
    
    if not player or not player['game_id']:
        return
    
    game = games.get(player['game_id'])
    if not game or not game.game_active:
        return
    
    paddle_y = data.get('y', 170)
    paddle_y = max(0, min(340, paddle_y))
    
    # Actualizar posición de la paleta
    if player_id == game.player1['id']:
        game.player1['paddle_y'] = paddle_y
    elif game.player2 and player_id == game.player2['id']:
        game.player2['paddle_y'] = paddle_y
    
    # Enviar estado actualizado
    emit('game_state', game.get_state(), room=game.game_id)

@socketio.on('game_tick')
def handle_game_tick():
    player_id = request.sid
    player = players.get(player_id)
    
    if not player or not player['game_id']:
        return
    
    game = games.get(player['game_id'])
    if not game or not game.game_active or not game.player2:
        return
    
    # Actualizar pelota
    scorer = game.update_ball()
    
    if scorer:
        # Notificar punto
        if scorer == 'player1':
            emit('point_scored', {'player': 1}, room=game.game_id)
        else:
            emit('point_scored', {'player': 2}, room=game.game_id)
        
        # Verificar fin del juego
        if (game.player1['score'] >= 11 and game.player1['score'] - game.player2['score'] >= 2) or \
           (game.player2['score'] >= 11 and game.player2['score'] - game.player1['score'] >= 2):
            
            winner = 1 if game.player1['score'] > game.player2['score'] else 2
            emit('game_over', {'winner': winner}, room=game.game_id)
            
            # Actualizar estadísticas
            update_game_stats(game, winner)
            
            # Limpiar juego
            del games[game.game_id]
            if player['game_id'] == game.game_id:
                player['game_id'] = None
            if game.player1['id'] in players:
                players[game.player1['id']]['game_id'] = None
            if game.player2['id'] in players:
                players[game.player2['id']]['game_id'] = None
    
    # Enviar estado actualizado
    emit('game_state', game.get_state(), room=game.game_id)

def update_game_stats(game, winner):
    # Actualizar estadísticas para jugadores autenticados
    users = load_users()
    
    # Jugador 1
    player1 = players.get(game.player1['id'])
    if player1 and player1['session_id'] and player1['session_id'] in session:
        username = session[player1['session_id']]['username']
        if username in users:
            users[username]['stats']['games_played'] += 1
            if winner == 1:
                users[username]['stats']['games_won'] += 1
                users[username]['stats']['multiplayer_wins'] += 1
    
    # Jugador 2
    if game.player2:
        player2 = players.get(game.player2['id'])
        if player2 and player2['session_id'] and player2['session_id'] in session:
            username = session[player2['session_id']]['username']
            if username in users:
                users[username]['stats']['games_played'] += 1
                if winner == 2:
                    users[username]['stats']['games_won'] += 1
                    users[username]['stats']['multiplayer_wins'] += 1
    
    save_users(users)

if __name__ == '__main__':
    print("""
    ===========================================
       PONG MULTIJUGADOR - SERVIDOR INICIADO
    ===========================================
    
    Servidor disponible en:
    - Local: http://localhost:5000
    - Red local: http://[TU-IP]:5000
    
    Para dispositivos móviles, asegúrate de estar
    en la misma red Wi-Fi y usar la IP correcta.
    """)
    
    # Crear archivos si no existen
    if not os.path.exists(USERS_FILE):
        save_users({})
    if not os.path.exists(ACHIEVEMENTS_FILE):
        save_achievements({})
    
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
