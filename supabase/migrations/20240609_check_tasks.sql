-- Check if there are any tasks in the database
DO $$
DECLARE
    task_record RECORD;
    task_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO task_count FROM tasks;
    RAISE NOTICE 'Total number of tasks: %', task_count;
    
    -- List all tasks
    RAISE NOTICE 'Task details:';
    FOR task_record IN SELECT id, title, status, created_by FROM tasks LOOP
        RAISE NOTICE 'Task: id=%, title=%, status=%, created_by=%', 
            task_record.id, task_record.title, task_record.status, task_record.created_by;
    END LOOP;
END $$; 