exports.up = function (db) {
  return db.runSql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar UNIQUE NOT NULL,
      password_hash varchar NOT NULL,
      display_name varchar NOT NULL,
      avatar_url varchar,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id uuid REFERENCES users(id),
      room_code varchar(12) UNIQUE NOT NULL,
      name varchar,
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT now(),
      ended_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id),
      joined_at timestamptz DEFAULT now(),
      left_at timestamptz,
      is_muted boolean DEFAULT false,
      is_camera_off boolean DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id),
      content text NOT NULL,
      sent_at timestamptz DEFAULT now()
    );
  `);
};

exports.down = function (db) {
  return db.runSql(`
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS participants;
    DROP TABLE IF EXISTS rooms;
    DROP TABLE IF EXISTS users;
  `);
};