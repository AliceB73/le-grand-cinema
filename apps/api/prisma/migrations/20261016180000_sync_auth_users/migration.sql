-- Keep public."User" aligned with Supabase Auth so spectator accounts
-- share the Auth UUID. Applied only when the auth schema is present.
CREATE OR REPLACE FUNCTION public.sync_cinema_user_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR length(NEW.email) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public."User" (id, email, role, "createdAt", "updatedAt")
  VALUES (
    NEW.id::text,
    lower(NEW.email),
    'USER'::"Role",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    "updatedAt" = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;

  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_cinema_user_from_auth();

  CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.sync_cinema_user_from_auth();
END
$$;
