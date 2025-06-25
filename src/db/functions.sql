-- Function to get total balances from transactions
CREATE OR REPLACE FUNCTION get_total_balances()
RETURNS TABLE (
    brokecoin DECIMAL,
    chips DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(CASE 
            WHEN currency = 'brokecoin' AND type = 'purchase_chips' AND status = 'completed' THEN amount
            WHEN currency = 'brokecoin' AND type = 'cashout_chips' AND status = 'completed' THEN -amount
            WHEN currency = 'brokecoin' AND type = 'refund' AND status = 'completed' THEN amount
            ELSE 0
        END), 0) as brokecoin,
        COALESCE(SUM(CASE 
            WHEN currency = 'chips' AND type = 'purchase_chips' AND status = 'completed' THEN amount
            WHEN currency = 'chips' AND type = 'cashout_chips' AND status = 'completed' THEN -amount
            WHEN currency = 'chips' AND type = 'bet' AND status = 'completed' THEN -amount
            WHEN currency = 'chips' AND type = 'win' AND status = 'completed' THEN amount
            WHEN currency = 'chips' AND type = 'refund' AND status = 'completed' THEN amount
            ELSE 0
        END), 0) as chips
    FROM transactions
    WHERE confirmed_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

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