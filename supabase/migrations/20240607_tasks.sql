-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('social', 'daily', 'other')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('chips', 'brokecoin')),
  task_link TEXT,
  created_by UUID NOT NULL REFERENCES admins(id),
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create task_comments table
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admins(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create task_attachments table
CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES admins(id),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create RLS policies
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- Create policy for tasks table (admins can access all tasks)
CREATE POLICY tasks_access_policy ON tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
    )
  );

-- Create policy for task_comments table
CREATE POLICY task_comments_access_policy ON task_comments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
    )
  );

-- Create policy for task_attachments table
CREATE POLICY task_attachments_access_policy ON task_attachments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
    )
  );

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);

-- Create function to update task status
CREATE OR REPLACE FUNCTION update_task_status(
  p_task_id UUID,
  p_status TEXT,
  p_admin_id UUID
)
RETURNS tasks AS $$
DECLARE
  updated_task tasks;
BEGIN
  UPDATE tasks
  SET 
    status = p_status,
    completed_at = CASE 
      WHEN p_status = 'completed' THEN NOW()
      ELSE completed_at
    END,
    updated_at = NOW()
  WHERE id = p_task_id
  RETURNING * INTO updated_task;

  -- Log the status change
  INSERT INTO admin_actions (
    admin_id,
    action_type,
    metadata
  ) VALUES (
    p_admin_id,
    'UPDATE_TASK_STATUS',
    jsonb_build_object(
      'task_id', p_task_id,
      'old_status', updated_task.status,
      'new_status', p_status
    )
  );

  RETURN updated_task;
END;
$$ LANGUAGE plpgsql;

-- Create function to delete task
CREATE OR REPLACE FUNCTION delete_task(
  p_task_id UUID,
  p_admin_id UUID
)
RETURNS void AS $$
BEGIN
  -- Log the deletion before actually deleting
  INSERT INTO admin_actions (
    admin_id,
    action_type,
    metadata
  ) VALUES (
    p_admin_id,
    'DELETE_TASK',
    jsonb_build_object(
      'task_id', p_task_id
    )
  );

  -- Delete the task (cascade will handle comments and attachments)
  DELETE FROM tasks WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql;