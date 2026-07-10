alter table public.employee_directory
add column if not exists title_prefix text,
add column if not exists first_name text,
add column if not exists last_name text,
add column if not exists position text,
add column if not exists work_line text,
add column if not exists bureau text,
add column if not exists division text,
add column if not exists section text;

alter table public.members
add column if not exists title_prefix text,
add column if not exists first_name text,
add column if not exists last_name text,
add column if not exists position text,
add column if not exists work_line text,
add column if not exists bureau text,
add column if not exists division text,
add column if not exists section text;
