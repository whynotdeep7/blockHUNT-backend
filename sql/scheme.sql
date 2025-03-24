CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'organizer'))
);

CREATE TABLE hackathons (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL ,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  organizer_id INT REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'active'
);

CREATE TABLE hackathon_participants (
  id SERIAL PRIMARY KEY,
  hackathon_id INT REFERENCES hackathons(id),
  user_id INT REFERENCES users(id),
  withdrawn BOOLEAN DEFAULT FALSE
);

CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  hackathon_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  idea TEXT NOT NULL,
  description TEXT NOT NULL, -- This has a NOT NULL constraint
  public_key VARCHAR(255) NOT NULL,
  teammate_names TEXT,
  github_link TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (hackathon_id) REFERENCES hackathons(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);