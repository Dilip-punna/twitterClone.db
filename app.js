const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let database = null;

const initializationDBAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at 3000");
    });
  } catch (e) {
    console.error(`DB server Error: ${e.message}`);
    process.exit(1);
  }
};

initializationDBAndServer();

const getFollowingPeople = async (username) => {
  const getTheFollowingQuery = `
    SELECT following_user_id FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE user.username = '${username}'`;

  const followingPeople = await database.all(getTheFollowingQuery);
  const arrayOfIds = followingPeople.map((each) => each.following_user_id);
  return arrayOfIds;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    // You should replace "SECRET_KEY" with your actual secret key
    jwt.verify(jwtToken, "SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payload.userId; // Store user ID in the request object
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
  SELECT * 
  FROM tweet INNER JOIN follower
  ON tweet.user_id = follower.following_user_id
  WHERE tweet.tweet_id = '${tweetId}' AND follower.follower_user_id='${userId}'`;
  const tweet = await database.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.post("/register", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
      INSERT INTO user(username, password, name, gender)
      VALUES('${username}','${hashedPassword}','${name}','${gender}')`;
      await database.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);

    if (isPasswordMatched) {
      const payload = { username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid Password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const { userId } = request; // userId from the request object
  const followingPeopleIds = await getFollowingPeople(userId); // Pass userId
  const getTweetQuery = `SELECT
  username, tweet, date_time AS dateTime
  FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
  WHERE user.user_id IN (${followingPeopleIds.join(",")})
  ORDER BY date_time DESC 
  LIMIT 4`;
  const tweets = await database.all(getTweetQuery);
  response.send(tweets);
});

app.get("/user/following", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getFollowQuery = `SELECT
  name
  FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE following_user_id = '${userId}'`;
  const tweets = await database.all(getFollowQuery);
  response.send(tweets);
});

app.get("/user/followers", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getFollowQuery = `SELECT
  DISTINCT name
  FROM follower INNER JOIN user ON user.user_id = follower.following_user_id
  WHERE following_user_id = '${userId}'`;
  const tweets = await database.all(getFollowQuery);
  response.send(tweets);
});

app.get(
  "/tweets/:tweetId",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT tweet,
    (SELECT COUNT(*) FROM like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT(*) FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet 
    WHERE tweet.tweet_id = '${tweetId}'`;
    const tweet = await database.get(getTweetQuery);
    response.send(tweet);
  }
);

app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT username
    FROM user INNER JOIN like ON user.user_id = like.user_id 
    WHERE tweet_id = '${tweetId}'`;
    const tweets = await database.all(getTweetQuery);
    const usersArray = tweets.map((each) => each.username);
    response.send({ likes: usersArray });
  }
);

app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT name, reply
    FROM user INNER JOIN reply ON user.user_id = reply.user_id 
    WHERE tweet_id = '${tweetId}'`;
    const tweets = await database.all(getTweetQuery);
    const usersArray = tweets.map((each) => ({
      name: each.name,
      reply: each.reply,
    }));
    response.send({ replies: usersArray });
  }
);

app.get("/user/tweets", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetQuery = `
  SELECT tweet,
  COUNT(DISTINCT like_id) AS likes,
  COUNT(DISTINCT reply_id) AS replies,
  date_time AS dateTime
  FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id=${userId}
  GROUP BY tweet.tweet_id`;
  const tweets = await database.all(getTweetQuery);
  response.send(tweets);
});

app.post("/user/tweets", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = request.userId; // userId from the request object
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createQuery = `
  INSERT INTO tweet(tweet, user_id, date_time)
  VALUES('${tweet}', '${userId}', '${dateTime}')`;
  await database.run(createQuery);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id= '${tweetId}'`;
  const tweet = await database.get(getTheTweetQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}'`;
    await database.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
