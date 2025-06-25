-- Test the RLS policies
DO $$
DECLARE
    test_user_id UUID;
    test_admin_id UUID;
    admin_count INTEGER;
    user_count INTEGER;
BEGIN
    -- Get a test user and admin ID
    SELECT id INTO test_user_id FROM users LIMIT 1;
    SELECT id INTO test_admin_id FROM admins LIMIT 1;

    -- Log the test IDs
    RAISE NOTICE 'Test User ID: %', test_user_id;
    RAISE NOTICE 'Test Admin ID: %', test_admin_id;

    -- Test tasks table access
    RAISE NOTICE 'Testing tasks table access...';
    
    -- Test as admin
    SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" = jsonb_build_object('sub', test_admin_id);
    
    SELECT COUNT(*) INTO admin_count FROM tasks;
    RAISE NOTICE 'Admin can access tasks: %', admin_count;

    -- Test as user
    SET LOCAL "request.jwt.claims" = jsonb_build_object('sub', test_user_id);
    
    SELECT COUNT(*) INTO user_count FROM tasks;
    RAISE NOTICE 'User can access tasks: %', user_count;

    -- Reset role
    RESET ROLE;
END $$; 