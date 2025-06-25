-- Add password_hash to admins table
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL;

-- Create index for username lookup
CREATE INDEX IF NOT EXISTS idx_admins_username ON admins(username);

-- Add last_login column
ALTER TABLE admins
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;

-- Create function to update last_login
CREATE OR REPLACE FUNCTION update_admin_last_login(p_admin_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE admins
  SET last_login = NOW()
  WHERE id = p_admin_id;
END;
$$ LANGUAGE plpgsql; 