-- SAFE position migration.
-- Validates expected row counts and IDs before making any changes.
-- Does not modify IDs or JSON data payloads.
BEGIN;

DO $validation$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
              'portfolio_skills',
              'portfolio_projects',
              'portfolio_items',
              'portfolio_services',
              'portfolio_posts'
          )
          AND column_name = 'position'
    ) THEN
        RAISE EXCEPTION 'Safety check failed: a position column already exists.';
    END IF;

    IF (SELECT count(*) FROM public.portfolio_skills) <> 5
       OR (SELECT count(*) FROM public.portfolio_skills
           WHERE id IN ('s1','s2','s3','smv8q4yrhia82r','smv8q5dgyp3sll')) <> 5
    THEN
        RAISE EXCEPTION 'Safety check failed: portfolio_skills IDs/count mismatch.';
    END IF;

    IF (SELECT count(*) FROM public.portfolio_projects) <> 3
       OR (SELECT count(*) FROM public.portfolio_projects
           WHERE id IN ('p1','pmv8u0n79v6ru0','pmv8we6jszm0fw')) <> 3
    THEN
        RAISE EXCEPTION 'Safety check failed: portfolio_projects IDs/count mismatch.';
    END IF;

    IF (SELECT count(*) FROM public.portfolio_items) <> 3
       OR (SELECT count(*) FROM public.portfolio_items
           WHERE id IN ('pfmv8qscyerqqfh','pfmv8rkcwkoyx6t','pfmva5g5x2cbgaf')) <> 3
    THEN
        RAISE EXCEPTION 'Safety check failed: portfolio_items IDs/count mismatch.';
    END IF;

    IF (SELECT count(*) FROM public.portfolio_services) <> 4
       OR (SELECT count(*) FROM public.portfolio_services
           WHERE id IN (
               'svmv8oyuye8zk8p',
               'svmv8p10p5s4xs7',
               'svmv8p31al8ik58',
               'svmv8p4vb31mxxc'
           )) <> 4
    THEN
        RAISE EXCEPTION 'Safety check failed: portfolio_services IDs/count mismatch.';
    END IF;

    IF (SELECT count(*) FROM public.portfolio_posts) <> 1
       OR (SELECT count(*) FROM public.portfolio_posts
           WHERE id IN ('bmva9pjrbse4oj')) <> 1
    THEN
        RAISE EXCEPTION 'Safety check failed: portfolio_posts IDs/count mismatch.';
    END IF;
END;
$validation$;

ALTER TABLE public.portfolio_skills ADD COLUMN position integer;
ALTER TABLE public.portfolio_projects ADD COLUMN position integer;
ALTER TABLE public.portfolio_items ADD COLUMN position integer;
ALTER TABLE public.portfolio_services ADD COLUMN position integer;
ALTER TABLE public.portfolio_posts ADD COLUMN position integer;

UPDATE public.portfolio_skills AS t
SET position = v.position
FROM (VALUES
    ('s1', 1),
    ('s2', 2),
    ('s3', 3),
    ('smv8q4yrhia82r', 4),
    ('smv8q5dgyp3sll', 5)
) AS v(id, position)
WHERE t.id = v.id;

UPDATE public.portfolio_projects AS t
SET position = v.position
FROM (VALUES
    ('p1', 1),
    ('pmv8u0n79v6ru0', 2),
    ('pmv8we6jszm0fw', 3)
) AS v(id, position)
WHERE t.id = v.id;

UPDATE public.portfolio_items AS t
SET position = v.position
FROM (VALUES
    ('pfmv8qscyerqqfh', 1),
    ('pfmv8rkcwkoyx6t', 2),
    ('pfmva5g5x2cbgaf', 3)
) AS v(id, position)
WHERE t.id = v.id;

UPDATE public.portfolio_services AS t
SET position = v.position
FROM (VALUES
    ('svmv8oyuye8zk8p', 1),
    ('svmv8p10p5s4xs7', 2),
    ('svmv8p31al8ik58', 3),
    ('svmv8p4vb31mxxc', 4)
) AS v(id, position)
WHERE t.id = v.id;

UPDATE public.portfolio_posts AS t
SET position = v.position
FROM (VALUES
    ('bmva9pjrbse4oj', 1)
) AS v(id, position)
WHERE t.id = v.id;

DO $verification$
BEGIN
    IF EXISTS (SELECT 1 FROM public.portfolio_skills WHERE position IS NULL)
       OR (SELECT count(DISTINCT position) FROM public.portfolio_skills) <> 5
    THEN
        RAISE EXCEPTION 'Verification failed: portfolio_skills positions invalid.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.portfolio_projects WHERE position IS NULL)
       OR (SELECT count(DISTINCT position) FROM public.portfolio_projects) <> 3
    THEN
        RAISE EXCEPTION 'Verification failed: portfolio_projects positions invalid.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.portfolio_items WHERE position IS NULL)
       OR (SELECT count(DISTINCT position) FROM public.portfolio_items) <> 3
    THEN
        RAISE EXCEPTION 'Verification failed: portfolio_items positions invalid.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.portfolio_services WHERE position IS NULL)
       OR (SELECT count(DISTINCT position) FROM public.portfolio_services) <> 4
    THEN
        RAISE EXCEPTION 'Verification failed: portfolio_services positions invalid.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.portfolio_posts WHERE position IS NULL)
       OR (SELECT count(DISTINCT position) FROM public.portfolio_posts) <> 1
    THEN
        RAISE EXCEPTION 'Verification failed: portfolio_posts positions invalid.';
    END IF;
END;
$verification$;

ALTER TABLE public.portfolio_skills ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.portfolio_projects ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.portfolio_items ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.portfolio_services ALTER COLUMN position SET NOT NULL;
ALTER TABLE public.portfolio_posts ALTER COLUMN position SET NOT NULL;

CREATE UNIQUE INDEX portfolio_skills_position_uidx
    ON public.portfolio_skills (position);
CREATE UNIQUE INDEX portfolio_projects_position_uidx
    ON public.portfolio_projects (position);
CREATE UNIQUE INDEX portfolio_items_position_uidx
    ON public.portfolio_items (position);
CREATE UNIQUE INDEX portfolio_services_position_uidx
    ON public.portfolio_services (position);
CREATE UNIQUE INDEX portfolio_posts_position_uidx
    ON public.portfolio_posts (position);

COMMIT;
