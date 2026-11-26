// RG: substituto do stdafx.h (MFC) para compilar só o áudio do Dn-FamiTracker fora do Windows
#pragma once
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#ifndef ASSERT
#define ASSERT(x) assert(x)
#endif
#ifndef TRACE
#define TRACE(...) ((void)0)
#endif
