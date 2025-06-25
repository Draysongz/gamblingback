-- Add role column to users table
ALTER TABLE users
ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'superadmin'));

-- Update existing users to have 'user' role
UPDATE users SET role = 'user' WHERE role IS NULL;

-- Add index for role column
CREATE INDEX idx_users_role ON users(role); 