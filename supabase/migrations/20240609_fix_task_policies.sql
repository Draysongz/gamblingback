-- Drop existing policy
DROP POLICY IF EXISTS tasks_access_policy ON tasks;

-- Create new policy that allows both admins and users to access tasks
CREATE POLICY tasks_access_policy ON tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
    )
  );

-- Drop existing policy for user_task_completions if it exists
DROP POLICY IF EXISTS user_task_completions_access_policy ON user_task_completions;

-- Create new policy for user_task_completions
CREATE POLICY user_task_completions_access_policy ON user_task_completions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM admins
      WHERE id = auth.uid()
    )
  ); 