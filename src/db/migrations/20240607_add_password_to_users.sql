-- Add password column to users table
ALTER TABLE users
ADD COLUMN password VARCHAR(255) NOT NULL DEFAULT '';

-- Update existing users with a default password (they will need to reset it)
UPDATE users
SET password = '$2b$10$defaultpasswordhash'
WHERE password = '';

-- Make password column required
ALTER TABLE users
ALTER COLUMN password SET NOT NULL; 