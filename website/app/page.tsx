'use client'

import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'
import { 
  FaBolt, FaShieldAlt, FaCode, FaServer, FaMicrophone, FaDatabase, 
  FaLock, FaRocket, FaBrain, FaDocker, FaTerminal, FaCheck, FaTimes,
  FaLinux, FaApple, FaWindows, FaMobile, FaChevronDown, FaChevronUp,
  FaGithub, FaNpm, FaDownload, FaExternalLinkAlt, FaCopy, FaCheckCircle,
  FaExclamationTriangle, FaInfoCircle, FaArrowRight, FaStar, FaGitAlt
} from 'react-icons/fa'
import { BiBrain } from 'react-icons/bi'
import { HiSparkles, HiCommandLine, HiShieldCheck, HiCog, HiChartBar } from 'react-icons/hi2'
import { MdComputer, MdVoiceChat, MdSecurity, MdBuild } from 'react-icons/md'

// Animation variants
const fadeInUp = {
  hidden: { opacity: 0, y: 60 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }
}

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
}

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }
}

// XR Avatar Component
const XRAvatar = () => (
  <motion.div 
    className="relative w-40 h-40 md:w-52 md:h-52"
    animate={{ 
      y: [0, -15, 0],
      rotateY: [0, 10, 0],
      rotateX: [0, -5, 0]
    }}
    transition={{ 
      duration: 6, 
      repeat: Infinity, 
      ease: "easeInOut" 
    }}
  >
    {/* Outer glow ring */}
    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 opacity-30 blur-2xl animate-pulse" />
    
    {/* Main avatar container */}
    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border-2 border-cyan-400/50 flex items-center justify-center overflow-hidden">
      {/* Animated rings */}
      <motion.div 
        className="absolute inset-2 rounded-full border border-cyan-400/30"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="absolute inset-4 rounded-full border border-purple-400/30"
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
      />
      
      {/* Center icon */}
      <div className="relative z-10">
        <span className="text-6xl md:text-7xl">⚡</span>
      </div>
      
      {/* Particle effects */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 bg-cyan-400 rounded-full"
          animate={{
            x: [0, Math.cos(i * 60 * Math.PI / 180) * 80],
            y: [0, Math.sin(i * 60 * Math.PI / 180) * 80],
            opacity: [1, 0],
            scale: [1, 0]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            delay: i * 0.5,
            ease: "easeOut"
          }}
          style={{ top: '50%', left: '50%', marginTop: -4, marginLeft: -4 }}
        />
      ))}
    </div>
    
    {/* Bottom label */}
    <motion.div 
      className="absolute -bottom-8 left-1/2 -translate-x-1/2 tag tag-cyan whitespace-nowrap"
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      v0.2 JARVIS Edition
    </motion.div>
  </motion.div>
)

// Counter Animation Component
const AnimatedCounter = ({ target, suffix = '', prefix = '' }: { target: number, suffix?: string, prefix?: string }) => {
  const [count, setCount] = useState(0)
  
  useEffect(() => {
    const duration = 2000
    const steps = 60
    const increment = target / steps
    let current = 0
    
    const timer = setInterval(() => {
      current += increment
      if (current >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(Math.floor(current))
      }
    }, duration / steps)
    
    return () => clearInterval(timer)
  }, [target])
  
  return <span>{prefix}{count}{suffix}</span>
}

// Navbar Component
const Navbar = () => {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])
  
  const navLinks = [
    { name: 'Features', href: '#features' },
    { name: 'Providers', href: '#providers' },
    { name: 'Commands', href: '#commands' },
    { name: 'Install', href: '#install' },
    { name: 'Security', href: '#security' },
    { name: 'FAQ', href: '#faq' },
  ]
  
  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass-strong py-3' : 'py-5'
      }`}
    >
      <div className="container-custom flex items-center justify-between">
        <a href="#" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-xl font-black text-black group-hover:scale-110 transition-transform">
            ⚡
          </div>
          <div>
            <span className="font-bold text-xl gradient-text">XR</span>
            <span className="text-xs text-xr-muted ml-2">by @ahmadrrrtx</span>
          </div>
        </a>
        
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a 
              key={link.name}
              href={link.href}
              className="text-sm text-xr-muted hover:text-cyan-400 transition-colors relative group"
            >
              {link.name}
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-cyan-400 group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </div>
        
        <div className="flex items-center gap-4">
          <a 
            href="https://github.com/ahmadrrrtx/xr" 
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex btn-primary text-sm py-2 px-4"
          >
            <FaGithub />
            GitHub
          </a>
          <button 
            className="md:hidden text-xl text-xr-muted"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <FaTimes /> : <FaBolt />}
          </button>
        </div>
      </div>
      
      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden glass-strong mt-2 mx-4 rounded-xl overflow-hidden"
          >
            <div className="p-4 space-y-3">
              {navLinks.map((link) => (
                <a 
                  key={link.name}
                  href={link.href}
                  className="block py-2 text-xr-muted hover:text-cyan-400 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.name}
                </a>
              ))}
              <a 
                href="https://github.com/ahmadrrrtx/xr" 
                className="btn-primary w-full justify-center mt-4"
              >
                <FaGithub />
                View on GitHub
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}

// Hero Section
const Hero = () => {
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 500], [0, 150])
  const opacity = useTransform(scrollY, [0, 300], [1, 0])
  
  return (
    <section className="min-h-screen flex items-center justify-center pt-20 pb-10 relative overflow-hidden">
      <motion.div style={{ y, opacity }} className="container-custom text-center">
        <motion.div 
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="max-w-5xl mx-auto"
        >
          {/* Badge */}
          <motion.div variants={fadeInUp} className="mb-8">
            <span className="tag tag-green inline-flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              v0.2 JARVIS Edition · 124 tests passing · MIT Licensed
            </span>
          </motion.div>
          
          {/* Avatar */}
          <motion.div variants={scaleIn} className="mb-12 flex justify-center">
            <XRAvatar />
          </motion.div>
          
          {/* Headline */}
          <motion.h1 variants={fadeInUp} className="text-4xl md:text-6xl lg:text-7xl font-black mb-6 leading-tight">
            The AI Agent You<br />
            <span className="gradient-text">Can Actually Trust</span>
          </motion.h1>
          
          {/* Subheadline */}
          <motion.p variants={fadeInUp} className="text-lg md:text-xl text-xr-muted max-w-3xl mx-auto mb-10">
            <strong className="text-xr-text">12 AI providers</strong> (Claude, GPT-4, Gemini, Llama, Mistral, etc.) · 
            <strong className="text-xr-text"> Zero-cost defaults</strong> · Hard spend ceiling · 
            <strong className="text-xr-text"> JARVIS computer control</strong> · Voice · 
            <strong className="text-xr-text"> Tamper-evident audit</strong> · Self-improving.
            <br className="hidden md:block" />
            <span className="text-cyan-400 font-semibold">BYOK — you bring your key, we ship nothing.</span>
          </motion.p>
          
          {/* Stats */}
          <motion.div variants={fadeInUp} className="flex flex-wrap justify-center gap-4 md:gap-8 mb-12">
            {[
              { value: '$0', label: 'To Run (Local + Free Cloud)', color: 'text-green-400' },
              { value: '12', label: 'AI Providers', color: 'gradient-text-green' },
              { value: '124', label: 'Tests Passing', color: 'text-cyan-400' },
              { value: '4', label: 'OS Supported', color: 'text-purple-400' },
            ].map((stat, i) => (
              <div key={i} className="glass rounded-2xl px-6 py-4 text-center min-w-[140px]">
                <div className={`text-2xl md:text-3xl font-bold ${stat.color}`}>
                  {stat.value}
                </div>
                <div className="text-xs text-xr-muted mt-1">{stat.label}</div>
              </div>
            ))}
          </motion.div>
          
          {/* CTA Buttons */}
          <motion.div variants={fadeInUp} className="flex flex-wrap justify-center gap-4">
            <a href="#install" className="btn-primary text-lg px-8 py-4">
              <FaDownload />
              Install Now — Free
            </a>
            <a 
              href="https://github.com/ahmadrrrtx/xr" 
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-lg px-8 py-4"
            >
              <FaGithub />
              View on GitHub
            </a>
          </motion.div>
        </motion.div>
        
        {/* Scroll indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-xr-muted"
          >
            <FaChevronDown className="text-2xl" />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  )
}

// Install Section
const Install = () => {
  const [activeOS, setActiveOS] = useState('linux')
  
  const osOptions = [
    { id: 'linux', name: 'Linux', icon: FaLinux, color: 'text-yellow-400' },
    { id: 'macos', name: 'macOS', icon: FaApple, color: 'text-gray-300' },
    { id: 'windows', name: 'Windows', icon: FaWindows, color: 'text-blue-400' },
    { id: 'termux', name: 'Termux', icon: FaMobile, color: 'text-green-400' },
  ]
  
  const installCommands = {
    linux: {
      title: 'Install on Linux',
      commands: [
        '# One command. Any OS. That\'s it.',
        'curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash',
        '',
        '# Then just type:',
        'xr "hello, who are you"',
        '',
        '# Interactive TUI (Claude Code-style)',
        'xr --tui',
        '',
        '# JARVIS GUI automation',
        'xr --computer "open browser and search for AI agents"',
        '',
        '# Hard budget ceiling — literally cannot exceed',
        'xr --budget 0.25 "build a full REST API"',
      ],
      note: 'Works on Ubuntu, Debian, Fedora, Arch, etc. Auto-installs Bun.',
      optional: [
        '# Optional: Install Ollama for free local AI',
        'curl -fsSL https://ollama.ai/install.sh | bash',
        'ollama pull qwen2.5:7b && ollama serve',
      ]
    },
    macos: {
      title: 'Install on macOS',
      commands: [
        '# One command. That\'s it.',
        'curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash',
        '',
        '# Voice works out of the box with "say" command!',
        'xr --voice  # Check voice stack',
        '',
        '# Interactive TUI',
        'xr --tui',
        '',
        '# Optional: Install Ollama for free local AI',
        'brew install ollama',
        'ollama pull llama3:8b',
        'ollama serve',
      ],
      note: 'Works on Intel and Apple Silicon Macs. Voice TTS uses built-in "say" command.',
      optional: []
    },
    windows: {
      title: 'Install on Windows',
      commands: [
        '# PowerShell (as Administrator)',
        'iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)',
        '',
        '# Then:',
        'xr doctor     # Check system health',
        'xr providers  # See all AI providers',
        '',
        '# Optional: Install Ollama',
        'irm https://ollama.ai/install.ps1 | iex',
      ],
      note: 'PowerShell 5.1+. Voice TTS uses built-in PowerShell SAPI.',
      optional: []
    },
    termux: {
      title: 'Install on Termux (Android)',
      commands: [
        '# Install Bun',
        'pkg install bun',
        '',
        '# Clone and install',
        'pkg install git',
        'git clone https://github.com/ahmadrrrtx/xr ~/xr',
        'cd ~/xr && bun install',
        '',
        '# Run',
        'bun run src/index.ts doctor',
      ],
      note: 'Works on Android without root! Use XR on your phone.',
      optional: []
    },
  }
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }
  
  return (
    <section id="install" className="section">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-12">
            <span className="tag tag-cyan mb-4 inline-block">Quick Start</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Install in <span className="gradient-text">30 seconds</span>
            </h2>
            <p className="text-xr-muted text-lg max-w-2xl mx-auto">
              One command. Any OS. No credit card. No vendor lock-in.
            </p>
          </motion.div>
          
          {/* OS Tabs */}
          <motion.div variants={fadeInUp} className="flex flex-wrap justify-center gap-3 mb-8">
            {osOptions.map((os) => (
              <button
                key={os.id}
                onClick={() => setActiveOS(os.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
                  activeOS === os.id 
                    ? 'bg-cyan-400 text-black' 
                    : 'glass hover:border-cyan-400/50'
                }`}
              >
                <os.icon className={os.color} />
                {os.name}
              </button>
            ))}
          </motion.div>
          
          {/* Command Block */}
          <motion.div variants={fadeInUp} className="max-w-3xl mx-auto">
            <div className="terminal">
              <div className="terminal-header">
                <div className="terminal-dot bg-red-500" />
                <div className="terminal-dot bg-yellow-500" />
                <div className="terminal-dot bg-green-500" />
                <span className="ml-4 text-sm text-xr-muted">
                  {osOptions.find(o => o.id === activeOS)?.name} Terminal
                </span>
                <button 
                  onClick={() => copyToClipboard(installCommands[activeOS as keyof typeof installCommands].commands.join('\n'))}
                  className="ml-auto text-xr-muted hover:text-cyan-400 transition-colors"
                >
                  <FaCopy />
                </button>
              </div>
              <div className="terminal-content">
                {installCommands[activeOS as keyof typeof installCommands].commands.map((line, i) => (
                  <div key={i} className={line.startsWith('#') ? 'text-xr-muted' : 'text-green-400'}>
                    {line || '\n'}
                  </div>
                ))}
                
                {installCommands[activeOS as keyof typeof installCommands].optional.length > 0 && (
                  <>
                    <div className="mt-6 mb-2 text-xr-muted"># Optional: Free Local AI</div>
                    {installCommands[activeOS as keyof typeof installCommands].optional.map((line, i) => (
                      <div key={i} className={line.startsWith('#') ? 'text-xr-muted' : 'text-green-400'}>
                        {line}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            
            <p className="text-center text-xr-muted mt-6">
              {installCommands[activeOS as keyof typeof installCommands].note}
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// Providers Section
const Providers = () => {
  const providers = {
    free: [
      { name: 'Ollama (Local)', icon: '🖥️', model: 'Llama3, Qwen, Mistral, Phi3', price: '$0 forever · offline · private', color: 'text-green-400' },
      { name: 'Groq', icon: '⚡', model: 'Llama-3.3-70B, Mixtral-8x7B, Gemma2', price: 'Free tier · 100+ req/min', color: 'text-green-400' },
      { name: 'Google Gemini', icon: '🔵', model: 'Gemini-1.5-Flash, 2.0, Pro', price: '15 req/min FREE · 1.5M context', color: 'text-green-400' },
      { name: 'DeepSeek', icon: '🟣', model: 'DeepSeek-Chat, Coder', price: '~$0.27/1M tokens · great for code', color: 'text-green-400' },
    ],
    cheap: [
      { name: 'Together AI', icon: '🏔️', model: 'Meta Llama-3.3-70B, Mistral', price: '$0.60–0.88/1M tokens', color: 'text-amber-400' },
      { name: 'OpenRouter', icon: '🔄', model: '100+ models · auto-route cheapest', price: 'Aggregated pricing · best deal', color: 'text-amber-400' },
      { name: 'Cerebras', icon: '⚡', model: 'CSM-8B · Fastest inference', price: '100+ tok/sec · $0.60/1M out', color: 'text-amber-400' },
      { name: 'Mistral AI', icon: '🌬️', model: 'Codestral (code), Large, Small', price: '$0.30–6/1M tokens · great coder', color: 'text-amber-400' },
      { name: 'Cohere', icon: '🧠', model: 'Command R+ · 128K context', price: '$3/1M tokens · best long context', color: 'text-amber-400' },
    ],
    premium: [
      { name: 'Anthropic Claude', icon: '🤖', model: 'Claude-3.5-Sonnet, Opus, Haiku', price: '$3–15/1M tokens · BEST QUALITY', color: 'text-purple-400' },
      { name: 'OpenAI GPT', icon: '🟢', model: 'GPT-4o, o1, o3, GPT-4-turbo', price: '$2.50–60/1M tokens · proven', color: 'text-purple-400' },
      { name: 'AWS Bedrock', icon: '☁️', model: 'Claude, Llama, Mistral via AWS', price: 'Enterprise pricing · compliant', color: 'text-purple-400' },
    ],
  }
  
  const tiers = [
    { id: 'free', label: '🆓 FREE', name: 'No cost to run', desc: 'Completely free or local', badge: 'tag-green' },
    { id: 'cheap', label: '💰 CHEAP', name: 'Cents per task', desc: 'Very affordable', badge: 'tag-amber' },
    { id: 'premium', label: '💎 PREMIUM', name: 'Best quality', desc: 'Worth every penny', badge: 'tag-purple' },
  ]
  
  return (
    <section id="providers" className="section bg-gradient-to-b from-transparent via-xr-surface/30 to-transparent">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-purple mb-4 inline-block">12 AI Providers</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Use any model. <span className="text-xr-muted">Bring your own key.</span>
            </h2>
            <p className="text-xr-muted text-lg">
              Switch providers instantly: <code className="text-cyan-400">xr use groq</code> · <code className="text-cyan-400">xr use anthropic</code> · <code className="text-cyan-400">xr use ollama</code>
            </p>
          </motion.div>
          
          <div className="space-y-10">
            {tiers.map((tier) => (
              <motion.div 
                key={tier.id}
                variants={fadeInUp}
                className="glass rounded-2xl p-8"
              >
                <div className="flex items-center gap-4 mb-6">
                  <span className={`tag ${tier.badge}`}>{tier.label}</span>
                  <span className="font-bold text-xl">{tier.name}</span>
                  <span className="text-xr-muted">— {tier.desc}</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {providers[tier.id as keyof typeof providers].map((provider, i) => (
                    <motion.div
                      key={i}
                      whileHover={{ scale: 1.02, y: -5 }}
                      className="provider-card cursor-pointer"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{provider.icon}</span>
                        <span className="font-semibold">{provider.name}</span>
                      </div>
                      <div className="text-sm text-xr-muted mb-2">{provider.model}</div>
                      <div className={`text-sm font-semibold ${provider.color}`}>
                        {provider.price}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
          
          <motion.div variants={fadeInUp} className="text-center mt-10">
            <p className="text-xr-muted">
              <FaInfoCircle className="inline mr-2 text-cyan-400" />
              <strong className="text-xr-text">Zero-cost default:</strong> XR auto-switches to free providers when budget is tight.
              Run <code className="text-cyan-400 bg-xr-surface px-2 py-1 rounded">xr providers</code> to see all + API key status.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// Features Section
const Features = () => {
  const features = [
    {
      icon: MdComputer,
      title: 'JARVIS Computer Control',
      desc: 'XR sees your screen via screenshots, reasons about it, and takes actions — click, type, scroll, open apps. The agent operates your computer.',
      tag: 'XR Only',
      tagColor: 'tag-green',
    },
    {
      icon: FaLock,
      title: 'Hard Cost Ceiling',
      desc: 'Spend ceiling enforced in CODE. checkBeforeStep() literally cannot exceed your budget — it blocks before the next call.',
      tag: 'Industry First',
      tagColor: 'tag-green',
    },
    {
      icon: FaShieldAlt,
      title: 'Provable Security',
      desc: 'xr test --attacks --json prints a SHA-256-signed block-rate. You measure it, don\'t market it.',
      tag: 'Published Numbers',
      tagColor: 'tag-cyan',
    },
    {
      icon: FaDatabase,
      title: 'Tamper-Evident Audit',
      desc: 'SHA-256 hash chain in SQLite. xr verify-log detects any tampering at exact entry #. $0, offline, private.',
      tag: 'Zero Infrastructure',
      tagColor: 'tag-purple',
    },
    {
      icon: BiBrain,
      title: 'Non-Regressive Skills',
      desc: 'Verified wins frozen as immutable baselines. Bad updates auto-rollback. The agent CANNOT forget what worked.',
      tag: 'No Catastrophic Forgetting',
      tagColor: 'tag-amber',
    },
    {
      icon: HiSparkles,
      title: 'Self-Improving',
      desc: 'After every successful task, XR analyzes and creates skills. Cross-session memory via FTS5. Learns from experience.',
      tag: 'Learns From Experience',
      tagColor: 'tag-purple',
    },
    {
      icon: FaDocker,
      title: 'Docker Sandbox',
      desc: 'rm -rf / and curl | bash are structurally impossible. Shell runs in isolated container.',
      tag: 'Zero Privilege Escalation',
      tagColor: 'tag-cyan',
    },
    {
      icon: MdVoiceChat,
      title: 'Voice Control',
      desc: '"Hey XR, open Safari and check my calendar." Wake word → Whisper STT → agent → system TTS. Local by default.',
      tag: 'Private by Design',
      tagColor: 'tag-purple',
    },
    {
      icon: FaServer,
      title: 'System Control (JARVIS)',
      desc: 'Volume, clipboard, screenshots, notifications, wifi, app launching — cross-platform. XR controls your computer.',
      tag: 'JARVIS-Level',
      tagColor: 'tag-green',
    },
    {
      icon: FaShieldAlt,
      title: 'Egress Allow-List',
      desc: 'Agent can\'t reach a domain you didn\'t approve. Exfiltration structurally impossible. Not even cloud metadata.',
      tag: 'Anti-Exfil Architecture',
      tagColor: 'tag-cyan',
    },
    {
      icon: FaTerminal,
      title: 'Interactive TUI',
      desc: 'Streaming output, slash commands (/ask, /plan, /skills), command history, multi-line input. Claude Code-level UX.',
      tag: 'Rich Terminal UI',
      tagColor: 'tag-purple',
    },
    {
      icon: FaRocket,
      title: 'BYOK — Zero Secrets',
      desc: 'XR ships NO API keys, stores NONE. Keys come from YOUR environment. Redacted from all logs.',
      tag: 'Pure BYOK',
      tagColor: 'tag-green',
    },
  ]
  
  return (
    <section id="features" className="section">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-cyan mb-4 inline-block">Core Features</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Everything Claude Code has. <span className="text-xr-muted">Plus what none of them ship.</span>
            </h2>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                whileHover={{ y: -8, scale: 1.02 }}
                className="glass rounded-2xl p-6 card-hover group"
              >
                <feature.icon className="text-4xl text-cyan-400 mb-4 group-hover:scale-110 transition-transform" />
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-xr-muted text-sm mb-4">{feature.desc}</p>
                <span className={`tag ${feature.tagColor}`}>{feature.tag}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// Commands Section
const Commands = () => {
  const commandCategories = [
    {
      title: 'Basic Commands',
      commands: [
        { cmd: 'xr "task"', desc: 'Run a task (default: agent mode)' },
        { cmd: 'xr --tui', desc: 'Interactive terminal UI (Claude Code-style)' },
        { cmd: 'xr --onboard', desc: '5-minute setup wizard' },
        { cmd: 'xr --computer "task"', desc: 'JARVIS GUI automation' },
        { cmd: 'xr --mode plan "task"', desc: 'Read-only analysis' },
        { cmd: 'xr --mode ask "task"', desc: 'Q&A only' },
      ]
    },
    {
      title: 'Budget & Provider',
      commands: [
        { cmd: 'xr --budget 0.50 "task"', desc: 'Hard USD ceiling' },
        { cmd: 'xr --max-steps 30 "task"', desc: 'Max agent steps (default: 12)' },
        { cmd: 'xr --max-tokens 50000 "task"', desc: 'Hard token ceiling' },
        { cmd: 'xr --provider groq "task"', desc: 'Use specific provider' },
        { cmd: 'xr providers', desc: 'Show all 12 providers + API key status' },
        { cmd: 'xr use anthropic', desc: 'Switch default provider' },
      ]
    },
    {
      title: 'System & Security',
      commands: [
        { cmd: 'xr doctor', desc: 'System health + audit chain check' },
        { cmd: 'xr test --attacks', desc: 'Injection benchmark (block-rate)' },
        { cmd: 'xr verify-log', desc: 'Verify tamper-evident audit log' },
        { cmd: 'xr sandbox', desc: 'Check Docker sandbox status' },
        { cmd: 'xr export', desc: 'Signed audit report' },
        { cmd: 'xr --dry-run "task"', desc: 'Simulate — touch nothing' },
      ]
    },
    {
      title: 'Skills & Memory',
      commands: [
        { cmd: 'xr skills', desc: 'List all available skills' },
        { cmd: 'xr index', desc: 'Index project for local RAG memory' },
        { cmd: 'xr memory', desc: 'Project memory + RAG status' },
        { cmd: 'xr cost', desc: 'Lifetime cost by model' },
        { cmd: 'xr serve', desc: 'Local dashboard (127.0.0.1:7842)' },
        { cmd: 'xr voice', desc: 'Voice stack check' },
      ]
    },
    {
      title: 'Git Integration',
      commands: [
        { cmd: 'xr git status', desc: 'Run any git command' },
        { cmd: 'xr git-md', desc: 'Generate xr.md project metadata' },
        { cmd: 'xr git commit "message"', desc: 'Commit with message' },
        { cmd: 'xr git push', desc: 'Push changes' },
        { cmd: 'xr git log --oneline', desc: 'View commit history' },
        { cmd: 'xr git branch', desc: 'List branches' },
      ]
    },
    {
      title: 'TUI Slash Commands',
      commands: [
        { cmd: '/ask', desc: 'Ask a question' },
        { cmd: '/plan', desc: 'Plan a task' },
        { cmd: '/mode [ask/plan/agent]', desc: 'Change mode' },
        { cmd: '/model [name]', desc: 'Switch model' },
        { cmd: '/budget [amount]', desc: 'Set budget' },
        { cmd: '/attacks', desc: 'Run security test' },
        { cmd: '/skills', desc: 'View skills' },
        { cmd: '/exit', desc: 'Exit TUI' },
      ]
    },
  ]
  
  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
  }
  
  return (
    <section id="commands" className="section bg-gradient-to-b from-transparent via-xr-surface/30 to-transparent">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-purple mb-4 inline-block">CLI Reference</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Every command at your <span className="gradient-text">fingertips</span>
            </h2>
            <p className="text-xr-muted text-lg max-w-2xl mx-auto">
              Complete reference of all XR commands. Click any command to copy.
            </p>
          </motion.div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {commandCategories.map((category, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                className="glass rounded-2xl p-6"
              >
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <HiCommandLine className="text-cyan-400" />
                  {category.title}
                </h3>
                <div className="space-y-2">
                  {category.commands.map((cmd, j) => (
                    <button
                      key={j}
                      onClick={() => copyCommand(cmd.cmd)}
                      className="w-full text-left p-3 rounded-lg bg-xr-surface2 hover:bg-xr-border transition-colors group flex items-center justify-between"
                    >
                      <code className="text-green-400 text-sm font-mono">{cmd.cmd}</code>
                      <FaCopy className="text-xr-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-xr-muted mt-3">{category.commands[0].desc.split(' ').slice(-2).join(' ')}...</p>
              </motion.div>
            ))}
          </div>
          
          <motion.div variants={fadeInUp} className="text-center mt-12">
            <div className="inline-flex items-center gap-4 glass rounded-2xl px-8 py-4">
              <span className="text-xr-muted">Pro tip:</span>
              <code className="text-cyan-400">xr --help</code>
              <span className="text-xr-muted">shows quick reference</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// Dashboard Preview Section
const Dashboard = () => {
  return (
    <section id="dashboard" className="section">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-cyan mb-4 inline-block">Live Preview</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Your <span className="gradient-text">Control Center</span>
            </h2>
            <p className="text-xr-muted text-lg max-w-2xl mx-auto">
              Real-time monitoring of cost, security, audit trail, and more — all in your browser.
            </p>
          </motion.div>
          
          {/* Dashboard Preview */}
          <motion.div variants={scaleIn} className="dashboard-preview max-w-5xl mx-auto">
            <div className="scan-line" />
            
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 bg-xr-surface border-b border-xr-border">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="flex-1 text-center text-sm text-xr-muted">
                http://127.0.0.1:7842/xr-control-center
              </div>
            </div>
            
            {/* Dashboard content */}
            <div className="p-6 md:p-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Cost Cockpit */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">💰</span>
                    <span className="text-sm text-xr-muted uppercase tracking-wider">Cost Cockpit</span>
                  </div>
                  <div className="text-3xl font-bold text-cyan-400 mb-2">$0.0312</div>
                  <div className="text-sm text-xr-muted">418K tokens · this machine</div>
                  <div className="mt-4 h-2 bg-xr-border rounded-full overflow-hidden">
                    <div className="h-full w-[12%] bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full" />
                  </div>
                  <div className="text-xs text-xr-muted mt-2">12% of $0.25 cap</div>
                </div>
                
                {/* Security Posture */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">🛡️</span>
                    <span className="text-sm text-xr-muted uppercase tracking-wider">Security Posture</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16">
                      <svg className="w-16 h-16 transform -rotate-90">
                        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-xr-border" />
                        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-green-400" strokeDasharray="176" strokeDashoffset="18" strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">90%</span>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-green-400">9/10</div>
                      <div className="text-xs text-xr-muted">attacks blocked</div>
                    </div>
                  </div>
                </div>
                
                {/* Audit Integrity */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">🔒</span>
                    <span className="text-sm text-xr-muted uppercase tracking-wider">Audit Integrity</span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="tag tag-green text-xs">✓ INTACT</span>
                  </div>
                  <div className="text-2xl font-bold">1,287</div>
                  <div className="text-sm text-xr-muted">entries · hash chain valid</div>
                </div>
              </div>
              
              {/* Second row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Injection Test Lab */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🔬</span>
                      <span className="text-sm text-xr-muted uppercase tracking-wider">Injection Test Lab</span>
                    </div>
                    <span className="tag tag-green text-xs">9/10 blocked</span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {['instruction_override', 'system_prompt_extraction', 'tool_hijack', 'data_exfiltration', 'ascii_smuggling'].map((type, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm p-2 bg-xr-surface2 rounded">
                        <span className="w-2 h-2 bg-green-400 rounded-full" />
                        <span className="text-xr-muted flex-1">{type.replace('_', ' ')}</span>
                        <span className="tag tag-green text-xs">blocked</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Project Stats */}
                <div className="glass rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">📦</span>
                    <span className="text-sm text-xr-muted uppercase tracking-wider">Project</span>
                  </div>
                  <div className="text-xl font-bold mb-4">my-saas-app</div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xr-muted">Files indexed:</span>
                      <span className="ml-2 font-bold">214</span>
                    </div>
                    <div>
                      <span className="text-xr-muted">Skills learned:</span>
                      <span className="ml-2 font-bold">7</span>
                    </div>
                    <div>
                      <span className="text-xr-muted">Frameworks:</span>
                      <span className="ml-2 font-bold">next, react, zod</span>
                    </div>
                    <div>
                      <span className="text-xr-muted">Frozen baselines:</span>
                      <span className="ml-2 font-bold">5</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
          
          <motion.div variants={fadeInUp} className="text-center mt-8">
            <p className="text-xr-muted">
              <FaLock className="inline mr-2 text-green-400" />
              127.0.0.1 only · token-authed · read-mostly · every state change is approval-gated & recorded
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// Comparison Section
const Comparison = () => {
  const features = [
    { name: '12 AI Providers', xr: true, claude: false, openclaw: 'partial', hermes: true },
    { name: 'Zero-cost default', xr: true, claude: false, openclaw: false, hermes: 'partial' },
    { name: 'Hard cost ceiling (enforced)', xr: true, claude: false, openclaw: false, hermes: false },
    { name: 'JARVIS computer control', xr: true, claude: false, openclaw: false, hermes: false },
    { name: 'Non-regressive skills', xr: true, claude: false, openclaw: false, hermes: 'partial' },
    { name: 'Tamper-evident audit (SHA-256)', xr: true, claude: false, openclaw: false, hermes: false },
    { name: 'Injection benchmark', xr: true, claude: false, openclaw: false, hermes: false },
    { name: 'Egress allow-list', xr: true, claude: false, openclaw: false, hermes: 'partial' },
    { name: 'Approval gates (fail-closed)', xr: true, claude: 'partial', openclaw: 'partial', hermes: false },
    { name: 'Docker sandbox', xr: true, claude: false, openclaw: 'partial', hermes: true },
    { name: 'Voice control (STT + TTS)', xr: true, claude: false, openclaw: true, hermes: true },
    { name: 'Self-improving', xr: true, claude: false, openclaw: false, hermes: true },
    { name: '1 runtime dep (zod only)', xr: true, claude: false, openclaw: false, hermes: false },
    { name: 'One-command install', xr: true, claude: true, openclaw: true, hermes: true },
  ]
  
  const getIcon = (value: boolean | string) => {
    if (value === true) return <FaCheck className="check-icon" />
    if (value === false) return <FaTimes className="cross-icon" />
    return <span className="partial-icon">{value}</span>
  }
  
  return (
    <section id="compare" className="section bg-gradient-to-b from-transparent via-xr-surface/30 to-transparent">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-cyan mb-4 inline-block">Competitive Analysis</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              The moat is the <span className="gradient-text">combination.</span>
            </h2>
          </motion.div>
          
          <motion.div variants={fadeInUp} className="overflow-x-auto">
            <table className="comparison-table min-w-[800px]">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th className="bg-cyan-400/10 text-cyan-400">XR ✅</th>
                  <th>Claude Code</th>
                  <th>OpenClaw</th>
                  <th>Hermes</th>
                </tr>
              </thead>
              <tbody>
                {features.map((feature, i) => (
                  <tr key={i}>
                    <td className="font-medium">{feature.name}</td>
                    <td className="bg-cyan-400/10">{getIcon(feature.xr)}</td>
                    <td>{getIcon(feature.claude)}</td>
                    <td>{getIcon(feature.openclaw)}</td>
                    <td>{getIcon(feature.hermes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// Security Section
const Security = () => {
  const securityFeatures = [
    { icon: FaLock, title: 'Egress Allow-List', desc: "Can't reach a domain you didn't approve. Exfiltration structurally impossible." },
    { icon: FaShieldAlt, title: 'Approval Gates', desc: 'Write/delete/shell need explicit approval. Fail-closed on timeout.' },
    { icon: FaDatabase, title: 'Tamper-Evident Audit', desc: 'SHA-256 hash chain in SQLite. Detects any change. No blockchain needed.' },
    { icon: FaDocker, title: 'Docker Sandbox', desc: 'Shell in isolated container. No network, dropped capabilities.' },
    { icon: FaBolt, title: 'Injection Test Lab', desc: 'Publishable block-rate with SHA-256 signature. Measure it.' },
    { icon: FaRocket, title: 'BYOK — Zero Secrets', desc: 'Ships no API keys, stores none. Keys from YOUR environment only.' },
  ]
  
  return (
    <section id="security" className="section">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-red mb-4 inline-block">Security Model — Honest</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Blast-radius reduction <span className="text-xr-muted">you can measure.</span>
            </h2>
            <p className="text-xr-muted text-lg max-w-2xl mx-auto">
              XR does not claim to be "unhackable." Prompt injection is unsolved industry-wide. What XR does is <strong className="text-xr-text">minimize blast radius</strong> and let you <strong className="text-xr-text">measure it</strong>.
            </p>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {securityFeatures.map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                whileHover={{ scale: 1.05 }}
                className="glass rounded-2xl p-6 text-center card-hover"
              >
                <feature.icon className="text-4xl text-cyan-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className="text-sm text-xr-muted">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
          
          {/* Migration Banner */}
          <motion.div variants={fadeInUp} className="mt-16 glass rounded-2xl p-8 text-center border border-red-500/30 bg-gradient-to-r from-red-500/5 to-purple-500/5">
            <h3 className="text-2xl font-bold text-red-400 mb-4">🚨 Coming from OpenClaw?</h3>
            <p className="text-xr-muted mb-6 max-w-2xl mx-auto">
              OpenClaw had <strong className="text-xr-text">138+ CVEs</strong>, <strong className="text-xr-text">135K exposed instances</strong>, and <strong className="text-xr-text">malicious skills marketplace</strong>.
              <br />
              XR is what you'd have to build ON TOP of OpenClaw — shipped from day one.
            </p>
            <a 
              href="https://github.com/ahmadrrrtx/xr/blob/main/MIGRATION.md" 
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2"
            >
              📋 Read the Migration Guide
              <FaExternalLinkAlt />
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

// FAQ Section
const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  
  const faqs = [
    {
      question: 'What makes XR different from Claude Code or OpenClaw?',
      answer: 'XR ships security from day one — not as an afterthought. While Claude Code and OpenClaw have great features, XR adds hard cost ceilings enforced in code, tamper-evident SHA-256 audit chains, egress allow-lists that prevent exfiltration, Docker sandbox isolation, and non-regressive skills that auto-rollback on regression. It\'s the architecture you\'d have to bolt onto other agents, built in from the start.'
    },
    {
      question: 'How does XR cost $0 to run?',
      answer: 'XR supports local models via Ollama completely free. It also auto-switches to free-tier cloud providers (Groq, Google Gemini) when your budget is tight. You only pay for API calls if you choose premium providers (Claude, GPT-4). With local Ollama, running XR costs absolutely nothing and works offline.'
    },
    {
      question: 'Is XR secure? Can prompt injection hack it?',
      answer: 'XR makes no "unhackable" claim — prompt injection is unsolved industry-wide. What XR does is minimize blast radius: untrusted content is scanned, dangerous actions are policy-blocked regardless of model output, and egress is allow-listed. A successful injection has a tiny blast radius. Run `xr test --attacks --json` to see your block-rate.'
    },
    {
      question: 'What does "BYOK" mean and why does it matter?',
      answer: 'BYOK = Bring Your Own Key. XR ships NO API keys and stores NONE. Your keys come from YOUR environment only. They\'re redacted from all logs before storage. This means XR has zero secrets to leak, and you maintain complete control over your AI spending.'
    },
    {
      question: 'How does the tamper-evident audit log work?',
      answer: 'Every action XR takes is logged with a SHA-256 hash that chains to the previous entry (like git). Run `xr verify-log` to check if any entry was tampered with. This gives you cryptographic proof of what XR did and when — useful for compliance, debugging, and security auditing.'
    },
    {
      question: 'Can XR learn and improve over time?',
      answer: 'Yes! XR has a self-improving engine (AutoLearner) that analyzes successful tasks and creates reusable skills. These skills are frozen as immutable baselines, and any update that breaks a past win is auto-rolled-back. The agent cannot forget what worked — no catastrophic forgetting.'
    },
    {
      question: 'What AI providers does XR support?',
      answer: 'XR supports 12 providers across three tiers: FREE (Ollama local, Groq, Google Gemini, DeepSeek), CHEAP (Together AI, OpenRouter, Cerebras, Mistral AI, Cohere), and PREMIUM (Anthropic Claude, OpenAI GPT, AWS Bedrock). Switch instantly with `xr use groq` or any provider name.'
    },
    {
      question: 'How does JARVIS computer control work?',
      answer: 'XR takes screenshots of your screen, uses vision AI to understand what\'s displayed, and takes actions (click, type, scroll, open apps) via cross-platform tools. It\'s like showing the agent what to do rather than describing it. Works on macOS, Linux, and Windows.'
    },
    {
      question: 'Does XR work on Windows and mobile?',
      answer: 'Yes! XR supports Linux, macOS, Windows (PowerShell), and Termux (Android). The install script auto-detects your OS. On Windows, use PowerShell as Administrator. On Android, use Termux without root.'
    },
    {
      question: 'How do I publish XR to npm?',
      answer: 'XR is already structured for npm publication. Update package.json with version 0.2.0, run `npm login`, then `npm publish --access public` from the xr directory. You can also set up GitHub Actions for automated publishing on release.'
    },
  ]
  
  return (
    <section id="faq" className="section bg-gradient-to-b from-transparent via-xr-surface/30 to-transparent">
      <div className="container-custom">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
        >
          <motion.div variants={fadeInUp} className="text-center mb-16">
            <span className="tag tag-purple mb-4 inline-block">FAQ</span>
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Frequently asked <span className="gradient-text">questions</span>
            </h2>
          </motion.div>
          
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                className="faq-item"
              >
                <div 
                  className="faq-question"
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                >
                  <span>{faq.question}</span>
                  {openIndex === i ? <FaChevronUp /> : <FaChevronDown />}
                </div>
                <div className={`faq-answer ${openIndex === i ? 'open' : ''}`}>
                  <p className="text-xr-muted leading-relaxed">{faq.answer}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// Footer
const Footer = () => {
  return (
    <footer className="py-16 border-t border-xr-border relative z-10">
      <div className="container-custom">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-xl font-black text-black">
                ⚡
              </div>
              <span className="font-bold text-xl gradient-text">XR</span>
            </div>
            <p className="text-xr-muted text-sm mb-4">
              The AI agent you can actually trust. BYOK, local-first, spend-capped, tamper-evident.
            </p>
            <div className="flex items-center gap-4">
              <a href="https://github.com/ahmadrrrtx/xr" className="text-xr-muted hover:text-cyan-400 transition-colors">
                <FaGithub className="text-2xl" />
              </a>
              <a href="https://www.npmjs.com/package/@ahmadrrrtx/xr" className="text-xr-muted hover:text-cyan-400 transition-colors">
                <FaNpm className="text-2xl" />
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Resources</h4>
            <ul className="space-y-2 text-xr-muted text-sm">
              <li><a href="https://github.com/ahmadrrrtx/xr#readme" className="hover:text-cyan-400 transition-colors">Documentation</a></li>
              <li><a href="https://github.com/ahmadrrrtx/xr/blob/main/MIGRATION.md" className="hover:text-cyan-400 transition-colors">Migration Guide</a></li>
              <li><a href="https://github.com/ahmadrrrtx/xr/blob/main/LAUNCH-POSTS.md" className="hover:text-cyan-400 transition-colors">Launch Posts</a></li>
              <li><a href="https://github.com/ahmadrrrtx/xr/issues" className="hover:text-cyan-400 transition-colors">Report Issues</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Features</h4>
            <ul className="space-y-2 text-xr-muted text-sm">
              <li><a href="#features" className="hover:text-cyan-400 transition-colors">Core Features</a></li>
              <li><a href="#providers" className="hover:text-cyan-400 transition-colors">12 AI Providers</a></li>
              <li><a href="#security" className="hover:text-cyan-400 transition-colors">Security</a></li>
              <li><a href="#commands" className="hover:text-cyan-400 transition-colors">Commands</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold mb-4">Legal</h4>
            <ul className="space-y-2 text-xr-muted text-sm">
              <li><a href="https://github.com/ahmadrrrtx/xr/blob/main/LICENSE" className="hover:text-cyan-400 transition-colors">MIT License</a></li>
              <li><a href="https://github.com/ahmadrrrtx" className="hover:text-cyan-400 transition-colors">Creator Profile</a></li>
              <li><a href="https://github.com/sponsors/ahmadrrrtx" className="hover:text-cyan-400 transition-colors">Sponsor This Project</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-xr-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xr-muted text-sm">
            ⚡ XR — by <a href="https://github.com/ahmadrrrtx" className="text-cyan-400 hover:underline">@ahmadrrrtx</a> · MIT License
          </p>
          <p className="text-xr-muted text-sm">
            You bring the key. We ship none. · XR costs us $0 to maintain and you $0 to trust.
          </p>
        </div>
      </div>
    </footer>
  )
}

// Main Page Component
export default function Home() {
  return (
    <main className="relative">
      <Navbar />
      <Hero />
      <Install />
      <Providers />
      <Features />
      <Commands />
      <Dashboard />
      <Comparison />
      <Security />
      <FAQ />
      <Footer />
    </main>
  )
}
