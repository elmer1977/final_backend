const express = require("express");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../model/user");
const Shop = require("../model/shop");
const { upload } = require("../multer");
const ErrorHandler = require("../utils/ErrorHandler");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const sendMail = require("../utils/sendMail");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const sendToken = require("../utils/jwtToken");
const {
    isAuthenticated,
    isAdmin,
    isSuperAdmin,
} = require("../middleware/auth");

const {
    generateResetToken,
    hashResetToken,
} = require("../utils/passwordReset");
const { frontendUrl } = require("../utils/frontendUrl");
const { getUploadedFileUrl, deleteUploadedFile } = require("../utils/uploadedFile");

const router = express.Router();

router.post("/create-user", upload.single("file"), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const userEmail = await User.findOne({ email });

    if (userEmail) {
      // if user already exits account is not create and file is deleted
      await deleteUploadedFile(getUploadedFileUrl(req.file));

      return next(new ErrorHandler("User already exits", 400));
    }

    const fileUrl = getUploadedFileUrl(req.file);

    const user = await User.create({
      name: name,
      email: email,
      password: password,
      avatar: fileUrl,
      isActivated: false,
    });

    const activationToken = createActivationToken({
      id: user._id,
      purpose: "user-activation",
    });

    const activationUrl = `${frontendUrl}/#/activation/${activationToken}`;

    // send email to user
    try {
      await sendMail({
        email: user.email,
        subject: "Activate your account",
        message: `Hello  ${user.name}, please click on the link to activate your account ${activationUrl} `,
      });
      res.status(201).json({
        success: true,
        message: `please check your email:- ${user.email} to activate your account!`,
      });
    } catch (err) {
      return next(new ErrorHandler(err.message, 500));
    }
  } catch (err) {
    return next(new ErrorHandler(err.message, 400));
  }
});

// create activation token
const createActivationToken = (user) => {
  return jwt.sign(user, process.env.ACTIVATION_SECRET, {
    expiresIn: "24h",
  });
};

// activate user account
router.post(
  "/activation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { activation_token } = req.body;

      const newUser = jwt.verify(
        activation_token,
        process.env.ACTIVATION_SECRET
      );
      if (!newUser) {
        return next(new ErrorHandler("Invalid token", 400));
      }
      let user;
      if (newUser.purpose === "user-activation" && newUser.id) {
        user = await User.findById(newUser.id);
        if (!user) {
          return next(new ErrorHandler("Activation account not found", 404));
        }
        user.isActivated = true;
        await user.save();
      } else {
        const { name, email, password, avatar } = newUser;
        user = await User.findOne({ email });
        if (!user) {
          user = await User.create({
            name,
            email,
            avatar,
            password,
            isActivated: true,
          });
        } else if (user.isActivated === false) {
          user.isActivated = true;
          await user.save();
        } else {
          return next(new ErrorHandler("User already exists", 400));
        }
      }
      sendToken(user, 201, res);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// login user
router.post(
  "/login-user",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return next(new ErrorHandler("Please provide the all filelds", 400));
      }
      const user = await User.findOne({ email }).select("+password");
      // +password is used to select the password field from the database

      if (!user) {
        return next(new ErrorHandler("user doesn't exits", 400));
      }

      // compore password with database password
      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(
          new ErrorHandler("Please provide the correct inforamtions", 400)
        );
      }

      if (user.isActivated === false) {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_NOT_ACTIVATED",
          message: "Your account has not been activated yet.",
        });
      }

      sendToken(user, 201, res);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// resend activation email for an inactive account
router.post(
  "/resend-activation",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return next(new ErrorHandler("Please provide your email and password", 400));
      }

      const user = await User.findOne({ email }).select("+password");
      if (!user || user.isActivated !== false) {
        return next(
          new ErrorHandler("Unable to resend activation email for this account", 400)
        );
      }

      const passwordMatches = await user.comparePassword(password);
      if (!passwordMatches) {
        return next(new ErrorHandler("Please provide the correct information", 400));
      }

      const activationToken = createActivationToken({
        id: user._id,
        purpose: "user-activation",
      });
      const activationUrl = `${frontendUrl}/#/activation/${activationToken}`;

      await sendMail({
        email: user.email,
        subject: "Activate your account",
        message: `Hello ${user.name}, please click on the link to activate your account: ${activationUrl}`,
      });

      res.status(200).json({
        success: true,
        message: `Activation email sent to ${user.email}`,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// forgot password
router.post(
  "/forgot-password",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email } = req.body;

      if (!email) {
        return next(new ErrorHandler("Please enter your email", 400));
      }

      const user = await User.findOne({ email });

      if (!user) {
        return next(new ErrorHandler("User doesn't exist", 400));
      }

      const resetToken = generateResetToken(user);

      await user.save();

      user.resetPasswordToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      user.resetPasswordTime = Date.now() + 15 * 60 * 1000;

      await user.save();

      const resetUrl = `${frontendUrl}/#/reset-password/${resetToken}`;

      await sendMail({
        email: user.email,
        subject: "Reset your password",
        message: `Hello ${user.name},

Please click the link below to reset your password:

${resetUrl}

This link will expire in 15 minutes.

If you did not request a password reset, please ignore this email.`,
      });

      res.status(200).json({
        success: true,
        message: `Password reset link sent to ${user.email}`,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// reset password
router.put(
  "/reset-password/:token",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { password, confirmPassword } = req.body;

      if (!password || !confirmPassword) {
        return next(
          new ErrorHandler("Please enter both password fields", 400)
        );
      }

      if (password !== confirmPassword) {
        return next(
          new ErrorHandler("Passwords do not match", 400)
        );
      }

      const resetPasswordToken = hashResetToken(req.params.token);

      const user = await User.findOne({
        resetPasswordToken,
        resetPasswordTime: { $gt: Date.now() },
      });

      if (!user) {
        return next(
          new ErrorHandler("Reset token is invalid or has expired", 400)
        );
      }

      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordTime = undefined;

      await user.save();

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.post(
  "/admin/reset-account-password",
  isAuthenticated,
  isSuperAdmin,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { entityType, entityId } = req.body;

      if (
        !["user", "seller"].includes(entityType) ||
        !mongoose.Types.ObjectId.isValid(String(entityId || ""))
      ) {
        return next(new ErrorHandler("Invalid account selected", 400));
      }

      const AccountModel = entityType === "seller" ? Shop : User;
      const account = await AccountModel.findById(entityId);
      if (!account) {
        return next(new ErrorHandler("Account not found", 404));
      }

      const resetToken = generateResetToken(account);
      await account.save();

      const resetPath =
        entityType === "seller"
          ? `/shop/reset-password/${resetToken}`
          : `/reset-password/${resetToken}`;
      const resetUrl = `${frontendUrl}/#${resetPath}`;

      await sendMail({
        email: account.email,
        subject: "Reset your password",
        message: `Hello ${account.name},

The Super Admin requested a password reset for your account.

Please click the link below to choose a new password:

${resetUrl}

This link will expire in 15 minutes. If you did not expect this email, please contact the site administrator.`,
      });

      res.status(200).json({
        success: true,
        message: "Password reset link sent to the account email",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// load user
router.get(
  "/getuser",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return next(new ErrorHandler("User doesn't exists", 400));
      }
      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

router.post(
  "/subscribe",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    const user = await User.findById(req.user.id);
    user.pushSubscription = req.body.subscription;
    await user.save();
    res.status(200).json({ success: true });
  })
);

router.get("/vapid-public-key", (req, res) => {
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// log out user
router.get(
  "/logout",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const cookieOptions = {
        expires: new Date(Date.now()),
        httpOnly: true,
        sameSite:
          process.env.NODE_ENV?.toLowerCase() === "production" ||
          process.env.FRONTEND_URL?.startsWith("https://") ||
          req.headers.origin?.startsWith("https://")
            ? "none"
            : "lax",
        secure:
          process.env.NODE_ENV?.toLowerCase() === "production" ||
          process.env.FRONTEND_URL?.startsWith("https://") ||
          req.headers.origin?.startsWith("https://"),
      };
      res.clearCookie("token", cookieOptions);
      res.status(201).json({
        success: true,
        message: "Log out successful!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user info
router.put(
  "/update-user-info",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password, phoneNumber, name } = req.body;

      /* The line `const user = await User.findOne({ email }).select("+password");` is querying the database
to find a user with the specified email address. The `select("+password")` part is used to include
the password field in the returned user object. By default, the password field is not selected when
querying the database for security reasons. However, in this case, the password field is needed to
compare the provided password with the stored password for authentication purposes. */
      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(
          new ErrorHandler("Please provide the correct information", 400)
        );
      }

      user.name = name;
      user.email = email;
      user.phoneNumber = phoneNumber;

      await user.save();

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user avatar
router.put(
  "/update-avatar",
  isAuthenticated,
  upload.single("image"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const existsUser = await User.findById(req.user.id);

      if (!req.file) {
        return next(new ErrorHandler("Avatar upload failed", 400));
      }

      try {
        await deleteUploadedFile(existsUser?.avatar);
      } catch (error) {
        console.warn("Previous avatar cleanup failed:", error.message);
      }

      const fileUrl = getUploadedFileUrl(req.file);

      /* The code `const user = await User.findByIdAndUpdate(req.user.id, { avatar: fileUrl });` is
        updating the avatar field of the user with the specified `req.user.id`. It uses the
        `User.findByIdAndUpdate()` method to find the user by their id and update the avatar field
        with the new `fileUrl` value. The updated user object is then stored in the `user` variable. */
      const user = await User.findByIdAndUpdate(req.user.id, {
        avatar: fileUrl,
      });

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user addresses
router.put(
  "/update-user-addresses",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      const sameTypeAddress = user.addresses.find(
        (address) => address.addressType === req.body.addressType
      );
      if (sameTypeAddress) {
        return next(
          new ErrorHandler(`${req.body.addressType} address already exists`)
        );
      }

      const existsAddress = user.addresses.find(
        (address) => address._id === req.body._id
      );

      if (existsAddress) {
        Object.assign(existsAddress, req.body);
      } else {
        // add the new address to the array
        user.addresses.push(req.body);
      }

      await user.save();

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// delete user address
router.delete(
  "/delete-user-address/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userId = req.user._id;
      const addressId = req.params.id;

      //   console.log(addressId);

      await User.updateOne(
        {
          _id: userId,
        },
        { $pull: { addresses: { _id: addressId } } }
      );

      const user = await User.findById(userId);

      res.status(200).json({ success: true, user });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user password
router.put(
  "/update-user-password",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select("+password");

      const isPasswordMatched = await user.comparePassword(
        req.body.oldPassword
      );

      if (!isPasswordMatched) {
        return next(new ErrorHandler("Old password is incorrect!", 400));
      }

      /* The line `if (req.body.newPassword !== req.body.confirmPassword)` is checking if the value of
    `newPassword` in the request body is not equal to the value of `confirmPassword` in the request
    body. This is used to ensure that the new password entered by the user matches the confirmation
    password entered by the user. If the two values do not match, it means that the user has entered
    different passwords and an error is returned. */
      if (req.body.newPassword !== req.body.confirmPassword) {
        return next(
          new ErrorHandler("Password doesn't matched with each other!", 400)
        );
      }
      user.password = req.body.newPassword;

      await user.save();

      res.status(200).json({
        success: true,
        message: "Password updated successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// find user infoormation with the userId
router.get(
  "/user-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// admin create user
router.post(
  "/admin/create-user",
  isAuthenticated,
  isAdmin("Admin"),
  upload.single("file"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { name, email, password, phoneNumber, role } = req.body;

      if (!name || !email || !password || !role) {
        return next(new ErrorHandler("Please provide all required fields", 400));
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        if (req.file) {
          await deleteUploadedFile(req.file.path || req.file.filename);
        }
        return next(new ErrorHandler("User already exists", 400));
      }

      if (!req.file) {
        return next(new ErrorHandler("User avatar is required", 400));
      }

      const fileUrl = getUploadedFileUrl(req.file);

      const user = await User.create({
        name,
        email,
        password,
        phoneNumber,
        role,
        avatar: fileUrl,
      });

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// admin update user
router.put(
  "/admin/update-user/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { name, email, phoneNumber, role } = req.body;

      const user = await User.findById(req.params.id);
      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      const oldestAdmin = await User.findOne({ role: "Admin" })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id");
      const isProtectedAdmin = oldestAdmin?._id.equals(user._id);

      if (role !== undefined && !["Admin", "user"].includes(role)) {
        return next(new ErrorHandler("Invalid user role", 400));
      }
      if (isProtectedAdmin && role !== undefined && role !== "Admin") {
        return next(
          new ErrorHandler("The oldest admin's role cannot be changed", 400)
        );
      }

      if (email && email !== user.email) {
        const emailTaken = await User.findOne({ email });
        if (emailTaken) {
          return next(new ErrorHandler("Email already in use", 400));
        }
      }

      user.name = name || user.name;
      user.email = email || user.email;
      user.phoneNumber = phoneNumber || user.phoneNumber;
      if (role !== undefined) {
        user.role = role;
      }

      await user.save();

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// all users --- for admin
router.get(
  "/admin-all-users",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const users = await User.find().sort({
        createdAt: -1,
      });
      const oldestAdmin = await User.findOne({ role: "Admin" })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id");
      const sellers = await Shop.find().sort({ createdAt: 1, _id: 1 });
      const userRows = users.map((user) => {
        const isProtectedAdmin = oldestAdmin?._id.equals(user._id) || false;
        return {
          ...user.toObject(),
          entityType: "user",
          displayRole: isProtectedAdmin
            ? "Super Admin"
            : user.role === "Admin"
              ? "Admin"
              : "Customer",
          isProtectedAdmin,
        };
      });
      const sellerRows = sellers.map((seller) => ({
        ...seller.toObject(),
        entityType: "seller",
        displayRole: "Seller",
        isProtectedAdmin: false,
      }));
      const allAccounts = [...userRows, ...sellerRows].sort((a, b) => {
        const roleOrder = {
          "Super Admin": 0,
          Admin: 1,
          Seller: 2,
          Customer: 3,
        };
        return (
          roleOrder[a.displayRole] - roleOrder[b.displayRole] ||
          new Date(a.createdAt) - new Date(b.createdAt) ||
          String(a._id).localeCompare(String(b._id))
        );
      });
      res.status(201).json({
        success: true,
        users: allAccounts,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// delete users --- admin
router.delete(
  "/delete-user/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return next(
          new ErrorHandler("User is not available with this id", 400)
        );
      }

      const oldestAdmin = await User.findOne({ role: "Admin" })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id");

      if (oldestAdmin?._id.equals(user._id)) {
        return next(
          new ErrorHandler("The oldest admin cannot be deleted", 400)
        );
      }

      await User.findByIdAndDelete(req.params.id);

      res.status(201).json({
        success: true,
        message: "User deleted successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
