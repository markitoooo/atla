// atlas-host-os/index.js - COMPLETE BACKEND IN ONE FILE
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/atlas-host', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// USER MODEL
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  companyName: String,
  subscription: {
    plan: { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
    status: { type: String, enum: ['active', 'canceled', 'past_due'], default: 'active' }
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// PROPERTY MODEL
const propertySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String
  },
  type: { type: String, enum: ['apartment', 'house', 'villa', 'condo'], required: true },
  bedrooms: Number,
  bathrooms: Number,
  maxGuests: Number,
  basePrice: { type: Number, required: true },
  status: { type: String, enum: ['active', 'inactive', 'maintenance'], default: 'active' }
}, { timestamps: true });

const Property = mongoose.model('Property', propertySchema);

// BOOKING MODEL
const bookingSchema = new mongoose.Schema({
  propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
  guestName: { type: String, required: true },
  guestEmail: { type: String, required: true },
  guestPhone: String,
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  adults: { type: Number, default: 1 },
  children: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['inquiry', 'confirmed', 'checked_in', 'checked_out', 'cancelled'],
    default: 'confirmed'
  },
  source: { type: String, enum: ['direct', 'airbnb', 'booking.com', 'vrbo'], default: 'direct' }
}, { timestamps: true });

const Booking = mongoose.model('Booking', bookingSchema);

// AUTH MIDDLEWARE
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, companyName } = req.body;

    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: 'User exists' });

    user = new User({
      email,
      password: await bcrypt.hash(password, 12),
      companyName
    });

    await user.save();

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, companyName: user.companyName }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: { id: user.id, email: user.email, companyName: user.companyName }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PROPERTY ROUTES
app.get('/api/properties', auth, async (req, res) => {
  try {
    const properties = await Property.find({ userId: req.user.id });
    res.json(properties);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/properties', auth, async (req, res) => {
  try {
    const property = new Property({
      userId: req.user.id,
      ...req.body
    });
    await property.save();
    res.status(201).json(property);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BOOKING ROUTES
app.get('/api/bookings', auth, async (req, res) => {
  try {
    const properties = await Property.find({ userId: req.user.id });
    const propertyIds = properties.map(p => p._id);
    
    const bookings = await Booking.find({ propertyId: { $in: propertyIds } })
      .populate('propertyId', 'name');
    
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookings', auth, async (req, res) => {
  try {
    const { propertyId, guestName, guestEmail, checkIn, checkOut, totalAmount } = req.body;
    
    // Check if property belongs to user
    const property = await Property.findOne({ _id: propertyId, userId: req.user.id });
    if (!property) return res.status(404).json({ error: 'Property not found' });
    
    // Check availability
    const conflictingBooking = await Booking.findOne({
      propertyId,
      status: 'confirmed',
      checkIn: { $lt: new Date(checkOut) },
      checkOut: { $gt: new Date(checkIn) }
    });
    
    if (conflictingBooking) {
      return res.status(400).json({ error: 'Dates not available' });
    }
    
    const booking = new Booking({
      propertyId,
      guestName,
      guestEmail,
      checkIn: new Date(checkIn),
      checkOut: new Date(checkOut),
      totalAmount,
      source: 'direct'
    });
    
    await booking.save();
    await booking.populate('propertyId', 'name');
    
    res.status(201).json(booking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Atlas Host OS Backend Running',
    timestamp: new Date().toISOString()
  });
});

// START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Atlas Host OS running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
