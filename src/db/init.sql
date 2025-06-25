-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(30) UNIQUE NOT NULL,
    wallet_address VARCHAR(44) UNIQUE NOT NULL,
    brokecoin_balance DECIMAL(20, 8) DEFAULT 0,
    chips_balance DECIMAL(20, 8) DEFAULT 0,
    avatar VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create user_stats table
CREATE TABLE IF NOT EXISTS user_stats (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    games_lost INTEGER DEFAULT 0,
    total_bets_placed INTEGER DEFAULT 0,
    total_winnings DECIMAL(20, 8) DEFAULT 0,
    highest_win DECIMAL(20, 8) DEFAULT 0,
    favorite_game VARCHAR(50),
    last_played_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create games table
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    mode VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    bet_amount DECIMAL(20, 8) NOT NULL,
    result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    min_bet DECIMAL(20, 8) NOT NULL,
    max_bet DECIMAL(20, 8) NOT NULL,
    current_players INTEGER DEFAULT 0,
    max_players INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create room_players table
CREATE TABLE IF NOT EXISTS room_players (
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);

-- Game Rooms Table
CREATE TABLE IF NOT EXISTS game_rooms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_type VARCHAR(50) NOT NULL,
    game_mode VARCHAR(50) NOT NULL,
    creator_wallet VARCHAR(44) NOT NULL,
    status VARCHAR(50) NOT NULL,
    current_players INTEGER NOT NULL DEFAULT 1,
    max_players INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for game_rooms
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);
CREATE INDEX IF NOT EXISTS idx_game_rooms_type_mode ON game_rooms(game_type, game_mode);
CREATE INDEX IF NOT EXISTS idx_game_rooms_creator ON game_rooms(creator_wallet);

-- Function to update game room
CREATE OR REPLACE FUNCTION update_game_room(
    p_room_id UUID,
    p_status VARCHAR,
    p_current_players INTEGER,
    p_metadata JSONB
) RETURNS game_rooms AS $$
DECLARE
    updated_room game_rooms;
BEGIN
    UPDATE game_rooms
    SET 
        status = COALESCE(p_status, status),
        current_players = COALESCE(p_current_players, current_players),
        metadata = COALESCE(p_metadata, metadata),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_room_id
    RETURNING * INTO updated_room;

    RETURN updated_room;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies for game_rooms
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game rooms are viewable by all authenticated users"
    ON game_rooms FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can create game rooms"
    ON game_rooms FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = creator_wallet);

CREATE POLICY "Users can update their own game rooms"
    ON game_rooms FOR UPDATE
    TO authenticated
    USING (auth.uid() = creator_wallet)
    WITH CHECK (auth.uid() = creator_wallet);

-- Trigger to update updated_at
CREATE TRIGGER set_timestamp
    BEFORE UPDATE ON game_rooms
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- Create function to update user balance
CREATE OR REPLACE FUNCTION update_user_balance(
    p_user_id UUID,
    p_brokecoin_delta DECIMAL,
    p_chips_delta DECIMAL
) RETURNS users AS $$
DECLARE
    v_user users;
BEGIN
    -- Update user balance
    UPDATE users
    SET 
        brokecoin_balance = brokecoin_balance + p_brokecoin_delta,
        chips_balance = chips_balance + p_chips_delta,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_user_id
    RETURNING * INTO v_user;

    -- Check if update was successful
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- Check for negative balance
    IF v_user.brokecoin_balance < 0 OR v_user.chips_balance < 0 THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    RETURN v_user;
END;
$$ LANGUAGE plpgsql;

-- Create function to update user stats
CREATE OR REPLACE FUNCTION update_user_stats(
    p_user_id UUID,
    p_game_result VARCHAR,
    p_bet_amount DECIMAL,
    p_win_amount DECIMAL
) RETURNS user_stats AS $$
DECLARE
    v_stats user_stats;
BEGIN
    -- Update user stats
    UPDATE user_stats
    SET 
        total_games_played = total_games_played + 1,
        games_won = CASE WHEN p_game_result = 'win' THEN games_won + 1 ELSE games_won END,
        games_lost = CASE WHEN p_game_result = 'loss' THEN games_lost + 1 ELSE games_lost END,
        total_bets_placed = total_bets_placed + 1,
        total_winnings = total_winnings + p_win_amount,
        highest_win = GREATEST(highest_win, p_win_amount),
        last_played_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id
    RETURNING * INTO v_stats;

    -- If no stats exist, create them
    IF NOT FOUND THEN
        INSERT INTO user_stats (
            user_id,
            total_games_played,
            games_won,
            games_lost,
            total_bets_placed,
            total_winnings,
            highest_win,
            last_played_at
        ) VALUES (
            p_user_id,
            1,
            CASE WHEN p_game_result = 'win' THEN 1 ELSE 0 END,
            CASE WHEN p_game_result = 'loss' THEN 1 ELSE 0 END,
            1,
            p_win_amount,
            p_win_amount,
            CURRENT_TIMESTAMP
        )
        RETURNING * INTO v_stats;
    END IF;

    RETURN v_stats;
END;
$$ LANGUAGE plpgsql;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_type ON games(type);
CREATE INDEX IF NOT EXISTS idx_rooms_game_type ON rooms(game_type);
CREATE INDEX IF NOT EXISTS idx_room_players_user_id ON room_players(user_id);

-- Create RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
    ON users FOR UPDATE
    USING (auth.uid() = id);

-- User stats policies
CREATE POLICY "Users can view their own stats"
    ON user_stats FOR SELECT
    USING (auth.uid() = user_id);

-- Games policies
CREATE POLICY "Users can view their own games"
    ON games FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own games"
    ON games FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Transactions policies
CREATE POLICY "Users can view their own transactions"
    ON transactions FOR SELECT
    USING (auth.uid() = user_id);

-- Rooms policies
CREATE POLICY "Anyone can view active rooms"
    ON rooms FOR SELECT
    USING (status = 'active');

CREATE POLICY "Users can join rooms"
    ON room_players FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave rooms"
    ON room_players FOR DELETE
    USING (auth.uid() = user_id);

-- Add trigger for updating updated_at
CREATE TRIGGER set_transaction_timestamp
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp(); 