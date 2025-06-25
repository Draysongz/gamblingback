-- Create user_task_completions table
CREATE TABLE IF NOT EXISTS user_task_completions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_at TIMESTAMP WITH TIME ZONE,
  metrics JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_task_completions_task_id ON user_task_completions(task_id);
CREATE INDEX IF NOT EXISTS idx_user_task_completions_user_id ON user_task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_task_completions_status ON user_task_completions(status);

-- Enable RLS
ALTER TABLE user_task_completions ENABLE ROW LEVEL SECURITY;

-- Create policy for user_task_completions table
CREATE POLICY user_task_completions_access_policy ON user_task_completions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
    )
  );

-- Create function to update user task completion status
CREATE OR REPLACE FUNCTION update_user_task_completion_status(
  p_task_id UUID,
  p_user_id UUID,
  p_status TEXT,
  p_metrics JSONB DEFAULT NULL
)
RETURNS user_task_completions AS $$
DECLARE
  updated_completion user_task_completions;
BEGIN
  UPDATE user_task_completions
  SET 
    status = p_status,
    completed_at = CASE 
      WHEN p_status = 'completed' THEN NOW()
      ELSE completed_at
    END,
    metrics = COALESCE(p_metrics, metrics),
    updated_at = NOW()
  WHERE task_id = p_task_id AND user_id = p_user_id
  RETURNING * INTO updated_completion;

  RETURN updated_completion;
END;
$$ LANGUAGE plpgsql; 