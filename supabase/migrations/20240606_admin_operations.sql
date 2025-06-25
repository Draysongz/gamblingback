-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alter users table to allow longer wallet addresses
ALTER TABLE users ALTER COLUMN wallet_address TYPE VARCHAR(255);

-- Create admin_actions table for audit logging
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES admins(id),
  action_type TEXT NOT NULL,
  target_user_id UUID REFERENCES users(id),
  target_transaction_id UUID REFERENCES transactions(id),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_action_type CHECK (
    action_type IN (
      'UPDATE_USER_BALANCE',
      'UPDATE_TRANSACTION_STATUS',
      'DELETE_USER',
      'BAN_USER',
      'UNBAN_USER'
    )
  )
);

-- Create function to get total system balances
CREATE OR REPLACE FUNCTION get_total_balances()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_brokecoin', COALESCE(SUM(brokecoin_balance), 0),
    'total_chips', COALESCE(SUM(chips_balance), 0)
  ) INTO result
  FROM users;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create RLS policies for admin tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- Create policy for admins table (only super_admins can access)
CREATE POLICY admins_access_policy ON admins
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
      AND role = 'super_admin'
    )
  );

-- Create policy for admin_actions table (admins can view their own actions)
CREATE POLICY admin_actions_access_policy ON admin_actions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
      AND (role = 'super_admin' OR id = admin_id)
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type ON admin_actions(action_type); 